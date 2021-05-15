import { init } from 'raspi'
import { I2C } from 'raspi-i2c'
import { DigitalOutput, HIGH, LOW } from 'raspi-gpio'
import { getSunrise, getSunset } from 'sunrise-sunset-js'
import fs from 'fs'

import { Config, CameraMode, Update } from './types'

const CONFIG_PATH = process.env.CONFIG || '/boot/camera.json'

// Hardware access
let i2c: I2C
let gpio4: DigitalOutput
let gpio17: DigitalOutput

/**
 * Load current configuration from disk, otherwise default to London
 * @returns Current configuration
 */
function loadConfig(): Config {
    try {
        const config = fs.readFileSync(CONFIG_PATH, 'utf8')
        return JSON.parse(config)
    } catch (e) {
        return {
            latitude: 51.5074,
            longitude: 0.1278
        }
    }
}

/**
 * Figure out the next state update from the sunset and sunrise times
 */
function nextUpdate(config: Config): Update {
    const now = new Date()

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)

    let nextSunrise = getSunrise(config.latitude, config.longitude)
    let nextSunset  = getSunset(config.latitude, config.longitude)

    // Handle wrapping onto next day
    if (nextSunrise < now)
        nextSunrise = getSunrise(config.latitude, config.longitude, tomorrow)
    if (nextSunset < now)
        nextSunset = getSunset(config.latitude, config.longitude, tomorrow)

    let sunriseNext = nextSunrise < nextSunset

    // Handle if the sunrise/sunset date is actually in the past
    if (sunriseNext && now > nextSunrise) {
        sunriseNext = false
    } else if (!sunriseNext && now > nextSunset) {
        sunriseNext = true
    }

    return sunriseNext ? {
        fires: nextSunrise,
        state: CameraMode.Colour
    } : {
        fires: nextSunset,
        state: CameraMode.NoIR
    }
}

/**
 * Updates feed to a new camera mode
 */
function update(mode: CameraMode) {
    console.log('Switching...')

    if (mode === CameraMode.Colour) {
        i2c.writeSync(0x70, 0x0, Buffer.alloc(1, 0x1))
        gpio4.write(LOW)
    } else {
        i2c.writeSync(0x70, 0x0, Buffer.alloc(1, 0x2))
        gpio4.write(HIGH)
    }

    console.log(`Switched to ${CameraMode[mode]} camera`)
}

/**
 * Initialises I2C and GPIO, along with checking what mode the camera is currently
 * in.
 *
 * It also checks whether we are currently in daytime, or night, and sets the camera
 * accordingly.
 */
async function setup(config: Config): Promise<Update> {
    return new Promise<Update>((resolve) => {
        init(() => {
            i2c = new I2C()
            gpio4 = new DigitalOutput('GPIO4')
            gpio17 = new DigitalOutput('GPIO17')

            i2c.writeSync(0x70, 0x0, Buffer.alloc(1, 0x1))
            gpio17.write(LOW)
            gpio4.write(LOW)

            const next = nextUpdate(config)

            if (next.state === CameraMode.Colour) {
                // We should be on NoIR until this fires
                console.log('Starting up with NoIR camera')
                update(CameraMode.NoIR)
            } else {
                // Colour instead
                console.log('Starting up with colour camera')
                update(CameraMode.Colour)
            }

            resolve(next)
        })
    })
}

function nextLoop(config: Config, nextMode: Update) {
    const now = Date.now()

    console.log(`Firing update to ${CameraMode[nextMode.state]} at ${nextMode.fires}`)
    console.log(`(in ${nextMode.fires.getTime() - now} + 1000 ms)`)

    setTimeout(() => {
        update(nextMode.state)

        nextMode = nextUpdate(config)
        nextLoop(config, nextMode)

    }, nextMode.fires.getTime() - now + 1000)
}

/**
 * Runs program
 *
 * Available options:
 * --test   Specify either colour (0) or NoIR (1) camera to use, and exit
 */
async function main() {
    // Init
    const config = loadConfig()
    const nextMode = await setup(config)

    const argv = process.argv
    if (argv.includes('--test')) {
        const index = argv.indexOf('--test')
        const mode = argv[index + 1]

        if (mode === '0') {
            update(CameraMode.Colour)
        } else if (mode === '1') {
            update(CameraMode.NoIR)
        }
    } else {
        // Start event loop
        nextLoop(config, nextMode)
    }
}

main()
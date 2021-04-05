export interface Config {
    latitude: number
    longitude: number
}

export enum CameraMode {
    Colour = 0,
    NoIR = 1
}

export interface Update {
    fires: Date
    state: CameraMode
}
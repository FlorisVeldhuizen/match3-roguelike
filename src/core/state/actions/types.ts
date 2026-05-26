import type { GameStore } from '../store'

export type StoreSet = (updater: (s: GameStore) => void) => void
export type StoreGet = () => GameStore

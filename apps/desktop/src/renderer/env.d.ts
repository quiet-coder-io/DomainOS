/// <reference types="vite/client" />

import type { DomainOSAPI } from '../preload/api'

declare global {
  interface Window {
    domainOS: DomainOSAPI
  }
}

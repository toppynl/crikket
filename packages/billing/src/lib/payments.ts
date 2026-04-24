import { getPolarSdkConfig } from "@crikket/env/polar"
import { Polar } from "@polar-sh/sdk"

let _polarClient: Polar | undefined

export function getPolarClient(): Polar {
  if (!_polarClient) {
    _polarClient = new Polar(getPolarSdkConfig())
  }
  return _polarClient
}

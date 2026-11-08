import assert from "node:assert/strict"
import test from "node:test"
import { INIT_V4_TOPIC } from "./decode"
import { addressFromTopic, currenciesFromV4Initialize } from "./pool"

const NATIVE = `0x${"0".repeat(64)}`
const TOKEN = `0x${"0".repeat(24)}a7362118a42ad52c68a694972b308cfb02e94cd2`

test("Initialize topics yield the two V4 currencies, including native ETH", () => {
  const currencies = currenciesFromV4Initialize([INIT_V4_TOPIC, `0x${"ab".repeat(32)}`, NATIVE, TOKEN])
  assert.deepEqual(currencies, {
    token0: "0x0000000000000000000000000000000000000000",
    token1: "0xa7362118a42ad52c68a694972b308cfb02e94cd2",
  })
  assert.equal(addressFromTopic("0x1234"), null)
  assert.equal(currenciesFromV4Initialize([INIT_V4_TOPIC, NATIVE]), null)
  assert.equal(currenciesFromV4Initialize(["0x" + "11".repeat(32), NATIVE, NATIVE, TOKEN]), null)
})

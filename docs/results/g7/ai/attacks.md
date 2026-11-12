# G7 ai: bypass attempts (live)

| Attempt | Transaction | Refusal |
|---|---|---|
| A stranger requests the investor's exit | `F7ZC8LJVA763C4gMcaWe4qKmzXM8UPNKhsXsKbTL924c` | Smart contract panicked: mandate:not-the-investor |
| A stranger proposes a trade | `B8aUXhfudBQeCpsQchkDGupPwaXfz25vTybAfLwE8oNv` | Smart contract panicked: mandate:not-the-manager |
| A stranger sends the manager's heartbeat | `pYG7UiSThHjppJgHkLEoMeue8XDzDC5dVpYtQKhagWt` | Smart contract panicked: mandate:not-the-manager |
| The AI's restricted key calls open_flatten | none: NEAR rejects it before inclusion | "Transaction method name <open_flatten> isn't allowed by the access key" |
| The AI's restricted key calls request_exit | none: NEAR rejects it before inclusion | "Transaction method name <request_exit> isn't allowed by the access key" |
| The manager account opens on the guardian's evidence | `9Cen8YuB7QNsi2VEKg52WCaoxHPV9LkFSJJ8fJFAbsGK` | Smart contract panicked: only the account that attested this evidence may open a job on it |
| Another account opens a job on the guardian's evidence | `GpgYqSsakmJe3sjXA9FUkupfVAAti9gRbniEtASFJVwj` | Smart contract panicked: only the account that attested this evidence may open a job on it |
| Anyone calls the private attestation callback | `CpuN7S9CbX5tfT8rAWYyfqQQvWe2N8pzQhcPWaM3hDLX` | Smart contract panicked: Method on_attested is private |
| An exit with no trigger | `5x4Jez8V76ZiYWtFkeZWX1asSTHLTvmHhQ6SR5q7PNYK` | Smart contract panicked: flatten-not-triggered |
| A forged snapshot (account value 1M USD) sent for attestation | `4gcMUUad8v7NE9jAXY6ppKMci1qyRLBrrm9RhB8kQBac` | judge log: "not attested hyperevm:0x011590c6d011222119229459a1fa75b18439ac1398f124e10561e9655b06db2f:0"; stored: null |
| A self-signed order relayed to KeelLeg | eth_call on 0x58675f5d6b9dd6394bD635b92Be9341B44F136DA | reverts `0x5cd5d233` = `BadSignature()` |
| A self-signed vault exit relayed to KeelVault | eth_call on 0x9AB31b03dDa4e1F08cD2f2fC8a1FFA69a5D7Cd0c | reverts `0x5cd5d233` = `BadSignature()` |
| The manager account opens on evidence it attested itself | `5bbAPoJTYoGSSn5dADyzgycwftzHTFXzKHNKopTsk7vL` | Smart contract panicked: mandate:manager-cannot-guard |
| Settle again after the rescue | `zKXSLrVyc7P1d2tQ6MJd3TRE2gW6rmY9oEqFNzsXiJs` | Smart contract panicked: no-open-job |
| Confirm the same exit receipt again | `AhG4D56UNTmwxVpvFEJTgsYBKFrfkbQcMAW7G1YV1i6n` | Smart contract panicked: evidence-reused |
| Open a second rescue | `AkCFZLNba8ZqVNKGgcxy1AEtKeyqZ8L6S1EKcBHsTJ3J` | Smart contract panicked: mandate:already-rescued |
| The AI proposes after the rescue | `9azorqzqheK7Ts8J6jvjLSscus8qZqSvoQwmGQa4WegE` | Smart contract panicked: mandate:strategy-not-active |

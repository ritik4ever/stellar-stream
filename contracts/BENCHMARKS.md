# Smart Contract Gas Benchmarks

*Note: These numbers act as the baseline for CI. Do not edit manually unless updating the baseline.*

| Function | CPU Instructions | Memory Bytes |
| --- | --- | --- |
| create_stream | 322937 | 47259 |
| claim | 263739 | 39617 |
| pause_stream | 86224 | 15461 |
| resume_stream | 88370 | 15874 |
| cancel | 244895 | 37285 |
| cancel_batch(5) | 1306689 | 187113 |
| create_split_stream | 530438 | 93100 |

## Batch cancel gas cost (#683)

`cancel_batch` cost scales **linearly** with the number of streams in the batch:
each additional stream adds roughly one single-`cancel` worth of work
(~250k CPU instructions / ~40k memory bytes). The batch is capped at **20
streams** per call, so the worst-case `cancel_batch` cost is about 20 × the
single `cancel` cost (~5M CPU instructions / ~780KB memory bytes), well
within the default Soroban resource limits for a single transaction.

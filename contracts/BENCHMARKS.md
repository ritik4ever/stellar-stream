# Smart Contract Gas Benchmarks

*Note: These numbers act as the baseline for CI. Do not edit manually unless updating the baseline.*

| Function | CPU Instructions | Memory Bytes |
| --- | --- | --- |
| create_stream | 354127 | 50985 |
| claim | 283642 | 42782 |
| pause_stream | 101977 | 18259 |
| resume_stream | 104289 | 18672 |
| cancel | 261997 | 40202 |
| cancel_batch(5) | 1359339 | 194138 |
| create_split_stream | 610310 | 114773 |

## Batch cancel gas cost (#683)

`cancel_batch` cost scales **linearly** with the number of streams in the batch:
each additional stream adds roughly one single-`cancel` worth of work
(~260k CPU instructions / ~40k memory bytes). The batch is capped at **20
streams** per call, so the worst-case `cancel_batch` cost is about 20 × the
single `cancel` cost (~5.2M CPU instructions / ~800KB memory bytes), well
within the default Soroban resource limits for a single transaction.

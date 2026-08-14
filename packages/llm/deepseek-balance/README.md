# @deepseek-ai/dsh-deepseek-balance

Official-DeepSeek account balance query, served to the browser as a Remote
namespace (`deepSeekBalance/query`). The connection facts (endpoint +
credential) are resolved per query by the mounting site — the DeepSeek chat
adapter's live options and per-request credential resolution — so the page
always reflects the configured account; the key travels only as the provider's
Authorization header.

The package stays dependency-light on purpose: the client assembly mounts the
generated Remote contribution, and loading its types must not drag host-side
sources into the browser program (the `dsh-llm-deepseek` package's dependencies
use Node builtins, which the client typecheck cannot see).

## Mounting

`dsh-llm-deepseek`'s apply mounts the service:

```ts
ctx.plugin(DeepSeekBalanceService, {
  resolveConnection: async () => ({ baseURL: options().baseURL, apiKey: await resolveApiKey(options()) }),
})
```

`dsh-api-remotes`'s client assembly imports the generated `./remote`
contribution so the browser can call `ctx.remote.deepSeekBalance.query()`.

## Wire

`GET {baseURL}/user/balance` with `Authorization: Bearer <key>`; the CNY
`balance_infos` row is normalized into
`DeepSeekBalanceResult` (`ok`, `isAvailable`, `currency`, `totalBalance`,
`grantedBalance`, `toppedUpBalance`) or an explicit
`missing-credential` / `fetch-failed` failure.

## Model Experience

No model-visible input: the balance read is a user-facing settings query and
never reaches a model request.

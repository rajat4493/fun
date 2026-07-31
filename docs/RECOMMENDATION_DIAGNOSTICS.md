# Recommendation diagnostics

F.U.N stores a correlated diagnostic record after each recommendation response. The write runs
after the user-facing response and does not block recommendation delivery.

Each record includes:

- user controls and request shape;
- interpreted intent;
- OpenAI request and response IDs;
- provider timing and success/failure;
- input, cached-input, output, and total token counts;
- trust rejections, retry count, fallback use, and availability-verification timing;
- the recommendation returned by the API.

Set `FUN_COLLECT_PROMPTS=true` in Vercel to also capture the user's free-text request, the exact
prompt sent to OpenAI, and OpenAI's raw response. Leave it unset for structured diagnostics without
prompt content. Full collection can contain sensitive user text, so access to the Upstash database
and exported files must remain restricted.

Export the latest 100 records:

```sh
npm run diagnostics:export
```

Export a chosen number and destination:

```sh
npm run diagnostics:export -- --limit=250 --output=./fun-diagnostics.json
```

The exporter is local-only. There is no public diagnostics endpoint in the application.

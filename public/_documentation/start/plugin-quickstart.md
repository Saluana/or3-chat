# Plugin quick start

Start with [Build your first plugin](/documentation/plugins/first-plugin): a portable greeting
app with a form, saved value, and repeatable browser lifecycle check.

From an OR3 Chat source checkout with dependencies and its local basic-auth
provider checkout available:

```sh
bun run dev:plugin --create /absolute/path/to/my-plugin --id my-tools.example
```

The command opens a dedicated local host and prints its sign-in details. Follow
the tutorial to edit the generated package; use `bun run dev` inside it on later
sessions. No model key or marketplace account is required for that tutorial.

[Plugins overview](/documentation/plugins/overview) explains portable versus trusted-host
packages. Continue with [Add features](/documentation/plugins/add-features) and
[Publish your plugin](/documentation/plugins/publish).

Direct changes in `app/plugins/` are source development; see
[Development setup](/documentation/start/development-setup) for that workflow.

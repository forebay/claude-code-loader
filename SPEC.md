# Claude Launcher - Specifications & Test Requirements

## Goal
The loader standard that runs Claude Code on the shared forebay host.

## Requirements
- [ ] **Parity**: Core functionality must mirror the opencode-loader exactly.
- [ ] **Command**: `forebay-host install` places the `cc` command, which launches Claude Code with the environment the loader's session host publishes.
- [ ] **Required proxy plugin**: The standard requires `claude-code-proxy`, the front door the session host serves on `127.0.0.1:<proxy.port>`; a launch whose required plugin is missing or disabled is refused with the fix that restores it.
- [ ] **Account login**: A provider's accounts are added with `forebay-host action claude-code-loader <provider> login`, for example `forebay-host action claude-code-loader claude-code-auth login`, and a login made while Claude Code runs takes effect without a restart.
- [ ] **No Default Provider**: Must NOT have a preinstalled default provider.
- [ ] **Empty State**: With no provider running, requests pass through to Anthropic on the user's own login. With providers running but none offering a model for a request, the request is answered 503 naming each provider's login action and `routing.modelMap` in the loader's settings file, and never passed through.

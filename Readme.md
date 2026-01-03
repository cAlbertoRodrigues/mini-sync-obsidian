# Mini-Sync-Obsidian

Projeto de sincronização de vaults do Obsidian entre múltiplos computadores,
baseado em snapshots, changesets e resolução explícita de conflitos.

## Arquitetura

- Monorepo
- Clean Architecture
- Core compartilhado (Domain + Application)
- Client (Electron) e Server (Express)

## Estrutura do projeto

- apps/
- packages/
  - core-domain
  - core-application

## Documentação técnica

- [Padrões do projeto](docs/padroes.md)

## Status

Projeto em desenvolvimento.
MVP focado em sincronização local segura.

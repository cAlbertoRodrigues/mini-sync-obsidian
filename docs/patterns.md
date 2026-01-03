# Padrões do Projeto — Mini-Sync-Obsidian

Este documento define as regras e convenções do projeto para manter consistência, manutenibilidade e respeito à arquitetura.

---

## Estrutura do monorepo

- `apps/`
  - Aplicações executáveis.
  - Ex.: `client-electron` (UI) e `server-express` (API/servidor local).

- `packages/`
  - Bibliotecas internas compartilhadas.
  - Ex.: `core-domain`, `core-application`, `adapters`, `infrastructure`.

- `docs/`
  - Documentação técnica e decisões do projeto.

---

## Regras de arquitetura (Clean Architecture)

### Regra de dependência (quem pode depender de quem)

- `packages/core-domain`
  - **Não depende de nada** do projeto (sem fs, rede, UI, banco, Electron, Express).
  - Contém apenas entidades, tipos e regras puras de domínio.

- `packages/core-application`
  - Pode depender de `core-domain`.
  - Contém **casos de uso** (use cases) e **ports** (interfaces).

- `packages/adapters` e `packages/infrastructure`
  - Podem depender do core (`core-domain` e `core-application`).
  - Implementam os ports (filesystem, HTTP, persistência, providers).

- `apps/*`
  - Conectam UI/servidor aos use cases.
  - Podem depender de tudo, mas **não devem concentrar regras de negócio**.

### Regras práticas (proibidos)

- `core-domain`:
  - Proibido importar `fs`, `path`, `electron`, `express`, `fetch/axios`, SDKs externos.
- `core-application`:
  - Proibido fazer IO diretamente (ler/escrever arquivo, request HTTP, banco).
  - Deve usar **ports** para qualquer interação externa.

---

## Nomenclatura e organização

### Pastas e arquivos

- Pastas: `kebab-case`
  - Ex.: `core-domain`, `core-application`
- Arquivos TypeScript: `kebab-case`
  - Ex.: `snapshot-store.ts`, `sync-transport.ts`

### Tipos e funções

- Tipos/Interfaces/Classes: `PascalCase`
  - Ex.: `Snapshot`, `VaultRepository`, `ConflictResolver`
- Funções/variáveis: `camelCase`
  - Ex.: `getLastSyncedSnapshotId`, `applyChangeSet`

---

## Imports e exports

### Imports internos do monorepo

- Preferir imports via pacote:
  - `@mini-sync/core-domain`
  - `@mini-sync/core-application`

- Evitar imports relativos longos entre packages:
  - ❌ `../../../core-domain/src/...`

### API pública dos packages

- Cada package deve exportar sua API por `src/index.ts`.
- Evitar importar arquivos internos diretamente (acoplamento desnecessário).

---

## Estilo de código

- TypeScript em modo `strict`.
- Código do domínio deve ser **puro** e facilmente testável.
- Evitar lógica “espalhada”: se é regra de sync/conflito, deve estar no core.

---

## Logs e erros (diretriz)

- Domain:
  - Sem logs. Sem dependências.
- Application:
  - Logs de fluxo (início/fim, estado, erro) via `Logger` port.
- Infra/Adapters:
  - Logs técnicos de IO (HTTP, filesystem, persistência).

---

## Commits e versionamento

### Conventional Commits

Exemplos:

- `feat(core-domain): add snapshot entity`
- `feat(core-application): add sync transport port`
- `fix(server): handle conflict response`
- `chore(repo): setup workspace`

### Versionamento

- Durante o MVP: versões `0.x`.
- Após estabilização e uso real: `1.0.0` (SemVer).

---

## Objetivo do MVP (resumo)

O MVP deve permitir sincronização local segura entre dois dispositivos com:

- snapshots + changesets
- detecção de conflitos
- decisão explícita do usuário em conflitos

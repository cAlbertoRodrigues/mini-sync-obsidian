# Contribuindo com o Mini-Sync-Obsidian

Este documento define as regras básicas para contribuição e manutenção do projeto,
com foco em consistência, qualidade e respeito à arquitetura definida.

---

## Arquitetura

O projeto segue os princípios de **Clean Architecture** em um **monorepo**.

Antes de contribuir, é obrigatório compreender:

- `packages/core-domain`
  - Contém apenas regras puras de domínio.
  - Não depende de filesystem, rede, UI ou frameworks.

- `packages/core-application`
  - Contém casos de uso e ports (interfaces).
  - Não realiza IO diretamente.

- `packages/adapters` e `packages/infrastructure`
  - Implementam os ports definidos na application.
  - Lidam com filesystem, HTTP, persistência e integrações externas.

- `apps/*`
  - Conectam UI e servidor aos casos de uso.
  - Não devem concentrar regras de negócio.

Violação dessas regras **não será aceita**.

---

## Padrão de commits (Conventional Commits)

Utilizamos o padrão **Conventional Commits**.

### Estrutura

<tipo>(escopo): <descrição>

### Tipos mais comuns

- `feat` — nova funcionalidade
- `fix` — correção de bug
- `chore` — tarefas de manutenção
- `docs` — documentação
- `refactor` — refatoração sem mudança de comportamento
- `test` — testes

### Exemplos válidos

- `feat(core-domain): add snapshot entity`
- `feat(core-application): add sync transport port`
- `fix(server): handle conflict response`
- `docs: add project standards`
- `chore(repo): setup pnpm workspace`

---

## Estilo de código

- TypeScript em modo `strict`.
- Seguir os padrões definidos em [`docs/padroes.md`](docs/padroes.md).
- Nomes claros e consistentes.
- Evitar duplicação de lógica.
- Priorizar legibilidade e clareza.

---

## Organização do código

- Novas entidades de domínio → `core-domain`
- Novos casos de uso → `core-application/use-cases`
- Integrações técnicas → `adapters` ou `infrastructure`
- UI e servidor → `apps/*`

Se houver dúvida sobre onde um código deve ficar, **rever a arquitetura antes de implementar**.

---

## Escopo do MVP

Durante o MVP:

- Priorizar sincronização local segura
- Evitar otimizações prematuras
- Evitar funcionalidades fora do escopo definido

Funcionalidades adicionais devem ir para o backlog.

---

## Considerações finais

Este projeto prioriza:

- previsibilidade
- segurança de dados
- clareza arquitetural

Decisões rápidas que violem esses princípios **não são aceitáveis**.

# Padrões do Projeto

Este documento descreve os padrões arquiteturais, organizacionais e de código utilizados no **Mini-sync-obsidian**.

O objetivo é garantir que o projeto permaneça:

- consistente
- previsível
- fácil de evoluir
- fácil de contribuir

## Arquitetura

O projeto segue princípios de **Clean Architecture** e **Domain‑Driven Design (DDD)**. A lógica central do sistema é isolada de infraestrutura, interface e provedores externos.

### Camadas

```
core-domain
    entidades e value objects

core-application
    serviços de aplicação
    orquestração do domínio

adapters
    implementações de infraestrutura

apps
    aplicações que utilizam o sistema
```

## Estrutura do Monorepo

```
mini-sync-obsidian
│
├ packages
│   ├ core-domain
│   └ core-application
│
├ apps
│   └ desktop
│
├ docs
│
└ scripts
```

### core-domain

Contém o **modelo de domínio do sistema de sincronização**. Exemplos:

```
entities
value-objects
ids
snapshots
conflicts
change-sets
```

Esta camada **não depende de nenhuma outra camada**.

### core-application

Contém **serviços que orquestram o domínio**. Exemplos:

```
SyncService
SnapshotService
ConflictResolver
```

Esta camada depende apenas de `core-domain`.

### adapters

Implementações concretas de infraestrutura. Exemplos:

```
node-file-hasher
node-history-repository
remote-folder-provider
google-drive-provider
```

### apps

Aplicações que utilizam o sistema. Exemplos:

```
desktop
cli
future-mobile
```

## Padrões de Domínio

### Value Objects

Objetos imutáveis que representam conceitos do domínio. Exemplos:

```
VaultId
FileHash
SnapshotId
```

Características:

- imutáveis
- sem identidade própria
- comparados por valor

### Entities

Objetos com identidade persistente. Exemplos:

```
Snapshot
HistoryEvent
```

### DTOs de sincronização

Objetos usados para transporte de dados entre serviços. Exemplos:

```
ChangeSet
Conflict
FileRecord
```

## Engine de Sincronização

O fluxo principal da sincronização segue o padrão:

```
scan vault
    ↓
generate snapshot
    ↓
compare snapshots
    ↓
generate ChangeSet
    ↓
resolve conflicts
    ↓
apply events
```

### Snapshot

Um snapshot representa o estado completo do vault em um momento específico.

```
Snapshot
 ├ id
 ├ vaultId
 ├ createdAt
 └ files[]
```

Snapshots são utilizados para detectar mudanças incrementais.

### ChangeSet

Um `ChangeSet` representa as diferenças entre dois estados.

```
added
modified
deleted
```

Ele é usado pelo mecanismo de sincronização para determinar quais ações executar.

### Conflict

Conflitos ocorrem quando mudanças incompatíveis acontecem em diferentes lados da sincronização. Tipos possíveis:

```
modified_modified
deleted_modified
modified_deleted
```

## Dependências

As dependências seguem a regra:

```
core-domain
      ↑
core-application
      ↑
adapters
      ↑
apps
```

Ou seja:

- camadas superiores dependem das inferiores
- camadas inferiores nunca dependem das superiores

## Convenções de Código

### Nomenclatura

Interfaces:

```
SyncProvider
FileHasher
HistoryRepository
```

Implementações:

```
NodeFileHasher
NodeHistoryRepository
GoogleDriveProvider
```

### Tipos

Tipos primitivos do domínio devem ser representados como aliases:

```ts
export type VaultId = string;
export type SnapshotId = string;
export type FileHash = string;
```

## Documentação

O projeto utiliza **TypeDoc** para gerar documentação automática.

Comando:

```
pnpm run docs
```

A documentação é gerada em `./docs`.

## Boas práticas

### Preferir funções puras no domínio

Sempre que possível:

- sem efeitos colaterais
- sem IO

### Infraestrutura isolada

Operações de:

- filesystem
- rede
- APIs externas

devem ficar em **adapters**.

### Serviços pequenos

Serviços devem ter responsabilidades claras. Exemplos:

```
SnapshotService
ConflictResolver
SyncService
```

## Versionamento

O projeto utiliza `pnpm workspace` para gerenciamento de pacotes.



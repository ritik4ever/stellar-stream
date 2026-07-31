# StellarStream

[![English](https://img.shields.io/badge/lang-en-red.svg)](../README.md)
[![Español](https://img.shields.io/badge/lang-es-green.svg)](README.es.md)
[![Português](https://img.shields.io/badge/lang-pt--br-blue.svg)](README.pt.md)

> **Nota sobre traduções:** Estas traduções podem estar desatualizadas em relação à versão em inglês. Consulte o arquivo [`README.md`](../README.md) em inglês para obter as informações mais recentes.

---

# StellarStream

StellarStream é um MVP (produto mínimo viável) de streaming de pagamentos básico para o ecossistema Stellar.
Inclui:
* Um painel em React para criar e monitorar streams
* Uma API em Node.js/Express para operações do ciclo de vida de streams
* Um scaffold de contrato inteligente Soroban para lógica de streams on-chain
* Uma pasta de backlog com rascunhos de tarefas de implementação

Este repositório é intencionalmente leve e fácil de estender.
Para perguntas comuns e solução de problemas, consulte [`FAQ.md`](../FAQ.md).
Para configuração de produção e operações, consulte [`DEPLOYMENT.md`](../DEPLOYMENT.md) e [`RUNBOOK.md`](../RUNBOOK.md).
Para política de segurança e relato de vulnerabilidades, consulte [`SECURITY.md`](../SECURITY.md).
Estamos comprometidos com um ambiente acolhedor; consulte [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md).

## 1) O Que o Projeto Faz

O StellarStream modela um stream de pagamento onde um remetente aloca um valor total durante uma duração fixa.
Conforme o tempo passa, o destinatário "adquire" (vest) valor continuamente.

**Comportamento atual do MVP:**
* Criar stream
* Listar streams com progresso ao vivo
* Cancelar stream
* Mostrar métricas calculadas (ativos/completos/adquiridos)
* Rastrear e exibir histórico de eventos para ações do ciclo de vida do stream

## 2) Arquitetura Atual

### Frontend (`frontend`, porta 3000)
* Aplicação React + Vite
* Usa o proxy `/api` para chamar o backend
* Consulta a lista de streams a cada 5 segundos

### Backend (`backend`, porta 3001)
* API REST Express
* Banco de dados SQLite para armazenamento persistente
* Worker indexador de eventos para rastrear o ciclo de vida do stream
* Calcula o progresso em tempo real a partir de timestamps
* Assina criptograficamente webhooks de saída usando HMAC-SHA256 para notificações seguras do ciclo de vida

### Contrato (`contracts`)
* Scaffold de contrato Soroban em Rust
* Suporta `create_stream`, `claimable`, `claim` e `cancel`
* Ainda não integrado com o backend neste MVP

## 3) Modelo Matemático do Stream

Para cada stream definido por um valor total ($A_{total}$), um timestamp de início ($t_{start}$) e uma duração em segundos ($d$), o timestamp de conclusão ($t_{end}$) é calculado como:

$$t_{end} = t_{start} + d$$

Em qualquer momento atual $t$, o tempo decorrido ($\Delta t$), a proporção de aquisição ($R$), o valor adquirido ($A_{vested}$) e o valor restante ($A_{remaining}$) são calculados usando uma função de clamp para restringir os valores à janela válida do stream:

$$\Delta t = \max(0, \min(t - t_{start}, d))$$

$$R = \frac{\Delta t}{d}$$

$$A_{vested} = A_{total} \times R$$

$$A_{remaining} = A_{total} - A_{vested}$$

**Regras de Estado**

- `scheduled`: quando $t < t_{start}$
- `active`: quando $t_{start} \le t < t_{end}$
- `completed`: quando $t \ge t_{end}$
- `canceled`: quando o stream foi encerrado antecipadamente de forma explícita

## 4) Referência da API

A documentação interativa da API está disponível via Swagger UI em:

- **Swagger UI:** `/api/docs`
- **Especificação OpenAPI bruta:** `/api/docs/openapi.json`

**URL Base:**

- Local: `http://localhost:3001`
- Proxy do frontend: `/api`

### `GET /api/health`
**Propósito:** Verificação de integridade do serviço

**Resposta:** `service`, `status`, `timestamp`

### `GET /api/streams`
**Propósito:** Listar streams ordenados do mais recente ao mais antigo, com filtragem e paginação opcionais

**Parâmetros de consulta (opcionais):**
- `status`: `scheduled` | `active` | `completed` | `canceled`
- `sender`: string (correspondência exata de remetente)
- `recipient`: string (correspondência exata de destinatário)
- `asset`: string (correspondência exata de código de ativo)
- `q`: string (termo de busca geral — busca em ID do stream, remetente, destinatário e código de ativo, sem distinção de maiúsculas)
- `page`: number (inteiro >= 1)
- `limit`: number (inteiro 1..100)

**Resposta:**
```json
{
  "data": "Stream[]",
  "total": "number",
  "page": "number",
  "limit": "number"
}
```

### `GET /api/streams/:id`
**Propósito:** Obter um stream individual por ID

**Resposta:** `{ "data": Stream }` | **Erro:** 404 se o stream não existir

### `GET /api/recipients/:accountId/streams`
**Propósito:** Obter todos os streams para um destinatário específico

**Resposta:** `{ "data": Stream[] }` (inclui progresso calculado para cada stream)

### `GET /api/assets`
**Propósito:** Obter a lista de permissões de ativos permitidos

**Resposta:** `{ "data": string[] }` (códigos de ativos normalizados)

### `POST /api/streams`
**Propósito:** Criar um novo stream

**Corpo da solicitação:**
```json
{
  "sender": "string",
  "recipient": "string",
  "assetCode": "string",
  "totalAmount": "number",
  "durationSeconds": "number",
  "startAt": "number (opcional, segundos Unix)"
}
```

**Resposta:** 201 Created com `{ "data": Stream }`

### `POST /api/streams/:id/cancel`
**Propósito:** Cancelar um stream existente

**Resposta:** `{ "data": Stream }` com estado `canceled` | **Erro:** 404 se o stream não existir

### `GET /api/open-issues`
**Propósito:** Retorna os itens do backlog de implementação mostrados na UI

**Resposta:** `{ "data": OpenIssue[] }`

### `GET /api/streams/:id/history`
**Propósito:** Obter a linha do tempo do histórico de eventos de um stream específico

**Resposta:** `{ "data": StreamEvent[] }` (ordenados por timestamp ascendente)

**Tipos de eventos:** `created`, `claimed`, `canceled`, `start_time_updated`

## 5) Executar Localmente

### Pré-requisitos

- Node.js 18+
- npm 9+
- Opcional para trabalho com contratos: Rust + toolchain Soroban

### Opção A: npm direto (Recomendado para Desenvolvimento)

A partir da raiz do repositório:

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
```

Alternativa manual:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

### Opção B: Docker Compose com Hot-Reload

Para desenvolvimento local com Docker, use o arquivo `docker-compose.override.yml` que monta automaticamente os diretórios de origem e habilita a recarga automática:

```bash
docker-compose up
```

- **Recarga automática do backend:** Alterações em `backend/src/` acionam reinicialização automática via `ts-node-dev`.
- **Recarga automática do frontend:** Alterações em `frontend/src/` acionam Vite HMR.
- **Volume do banco de dados:** Persiste entre reinicializações.

### Compilação

```bash
npm run build
```

## 6) Licença

MIT
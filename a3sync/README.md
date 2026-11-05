# a3sync — Conector a3innuva Nómina → App de Fichajes

Azure Function App **func-a3sync-prod** (Flex Consumption, Node 20, North Europe, rg-fichajes-prod).
Es la única pieza que habla con a3. La app (SWA) solo lee y escribe tablas `fich.A3*`.

## Funciones
- `a3/callback` (HTTP, anónima): vuelta del login de Wolters Kluwer tras «Conectar con a3». Valida el `state`, canjea el código y guarda el refresh token en Key Vault.
- `a3Solicitudes` (cada 5 min): atiende las sincronizaciones pedidas desde la app.
- `a3Nocturna` (01:30 UTC): sincronización diaria de cambios; los domingos, completa.

## Configuración (variables de la Function App)
| Variable | Valor |
|---|---|
| `KEY_VAULT_URL` | `https://kv-fichajes-prod.vault.azure.net/` |
| `SQL_SERVER` | `sql-fichajes-prod-neu.database.windows.net` |
| `SQL_DATABASE` | `sqldb-fichajes-prod` |

Identidad administrada del sistema activada, con:
- Key Vault: rol **Key Vault Secrets Officer** (lee `a3-client-secret` y `a3-apikey`; escribe `a3-refresh-token`).
- Azure SQL: usuario `[func-a3sync-prod] FROM EXTERNAL PROVIDER` con los permisos del bloque final de `db/010_a3.sql`.

## Desarrollo
```
npm install
npm test
```

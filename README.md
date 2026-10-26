# Fichajes · Grupo Arquisocial

Aplicación web de registro de jornada. Usuarios propios (email de cualquier dominio + contraseña), sin cuenta de Microsoft.
Todo se compila y despliega en la nube (GitHub Actions → Azure Static Web Apps). No requiere nada instalado en local.

## Estructura
| Carpeta | Contenido |
|---|---|
| `web/` | Portal React + Vite (TypeScript) |
| `api/` | Azure Functions v4 Node 20 (TypeScript) — API `/api/*` |
| `db/`  | Scripts SQL (ejecutar en orden en el Query editor del portal) |
| `.github/workflows/` | CI/CD generado por Azure Static Web Apps (un workflow por SWA/rama) |

## Ramas y entornos
| Rama | Entorno | Static Web App | Base de datos |
|---|---|---|---|
| `main` | Pruebas | swa-fichajes-pruebas | sql-fichajes-test-neu / sqldb-fichajes-test |
| `Produccion` | Producción | SWA de producción (salmon-pebble-0a74a1503) | sql-fichajes-prod-neu / sqldb-fichajes-prod |

Flujo: se trabaja en `main` (despliega a pruebas) y se pasa a producción con un Pull Request `main` → `Produccion`.

## Configuración
**Static Web App → Settings → Environment variables**
| Variable | Valor |
|---|---|
| `SQL_CONNECTION_STRING` | `Server=tcp:<servidor>.database.windows.net,1433;Database=<bd>;User ID=app_fichajes;Password=<...>;Encrypt=true;TrustServerCertificate=false;Connection Timeout=60;` |

**GitHub → Settings → Secrets and variables → Actions**: un secreto `AZURE_STATIC_WEB_APPS_API_TOKEN_<SWA>` por Static Web App (lo crea Azure al conectar el repo).

La clave de firma de sesiones (`JWT_SECRET`) y la clave de configuración inicial (`SETUP_KEY`) se generan dentro de SQL (`fich.Config`, script 002). La `SETUP_KEY` se consulta con `SELECT Valor FROM fich.Config WHERE Clave = 'SETUP_KEY'`, se usa en `/setup` y se borra sola al crear el primer administrador.

## Seguridad
- Contraseñas con bcrypt (coste 12); mínimo 10 caracteres con letras y números.
- Bloqueo 15 min tras 5 intentos fallidos.
- Sesión JWT en cookie HttpOnly + Secure + SameSite=Strict (10 h), revalidada contra BD en cada petición.
- Cabecera anti-CSRF `X-Requested-With: fichajes` y CSP estricta.
- Fichajes y auditoría en tablas **LEDGER append-only**. Hora del servidor (UTC).
- Usuario SQL `app_fichajes` con permisos mínimos.

## Notas
- La BD serverless gratuita se auto-pausa: la primera petición tras la pausa puede tardar hasta ~1 min (la API reintenta).
- Las rutas de Functions no pueden empezar por `admin` (reservado), por eso la gestión está en `/api/gestion/*`.

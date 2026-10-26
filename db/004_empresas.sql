/* =====================================================================
   Script 004 - Gestión de empresas desde la app (solo ADMIN)
   Permite a la API crear empresas, renombrarlas y activarlas/desactivarlas.
   Las empresas no se borran (no se concede DELETE).
   Ejecutar en sqldb-fichajes-test y sqldb-fichajes-prod.
   ===================================================================== */
GRANT INSERT, UPDATE ON fich.Empresas TO app_fichajes;

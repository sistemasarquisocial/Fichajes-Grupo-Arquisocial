/* =====================================================================
   014 - Acceso con DNI/NIE y correo profesional
   - El acceso pasa a ser con DNI/NIE (fich.Usuarios.DNI, ya único). La primera vez la contraseña es el propio DNI/NIE
     y se obliga a cambiarla. Quien no tiene DNI (administradores creados a mano) sigue entrando con su email.
   - fich.Usuarios.EmailCorporativo: correo del grupo. Lo rellena el conector a3 si el email profesional de a3 es de un
     dominio corporativo (A3_DOMINIOS_CORPORATIVOS, por defecto arquisocial.es); también se puede poner a mano.
   Ejecutar en sqldb-fichajes-prod. En el portal: 014_login_dni_correo_profesional_portal.sql (sin GO).
   ===================================================================== */
ALTER TABLE fich.Usuarios ADD EmailCorporativo NVARCHAR(254) NULL;
GO
/* Relleno inicial con los emails profesionales de a3 de arquisocial.es */
UPDATE u SET EmailCorporativo = LOWER(LTRIM(RTRIM(ae.EmailProfesional)))
  FROM fich.Usuarios u
  JOIN fich.A3Empleados ae ON ae.EmpresaA3 = u.EmpresaA3 AND ae.EmpleadoA3 = u.EmpleadoA3
 WHERE LOWER(LTRIM(RTRIM(ae.EmailProfesional))) LIKE '%@arquisocial.es';
GO
SELECT COUNT(*) AS Usuarios, COUNT(DNI) AS ConDNI, COUNT(EmailCorporativo) AS ConCorreoProfesional FROM fich.Usuarios;
GO

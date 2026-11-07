import ExcelJS from "exceljs";
import { DatosExportacion } from "../api";
import { descargar, Informe, logoPng, MARCA, partes, prepararInforme, TEXTO_LEGAL, nombreArchivoEquipo } from "./comun";

/* Libro Excel con la identidad de Grupo Arquisocial.
   - Un empleado: Resumen · Detalle diario · Fichajes.
   - Varios empleados: Resumen equipo · Detalle diario · Fichajes (con columnas Empleado y Centro para filtrar). */

const argb = (c: string) => "FF" + c.replace("#", "").toUpperCase();
const relleno = (c: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(c) } });
const FUENTE = "Calibri";
const bordeFila = { bottom: { style: "hair" as const, color: { argb: "FFDDE1D9" } } };

/** Fecha como serial de Excel sin desfase horario (la hora mostrada es la de Madrid). */
const fechaExcel = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00Z`);
/** Hora "HH:MM" o minutos como fracción de día, para que Excel pueda sumar. */
const horaExcel = (hhmm: string) => (hhmm ? (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))) / 1440 : null);
const minExcel = (min: number) => min / 1440;
const col = (n: number) => String.fromCharCode(64 + n);

function cabecera(ws: ExcelJS.Worksheet, columnas: number, titulo: string, periodo: string, logoId: number) {
  for (let r = 1; r <= 3; r++) {
    ws.getRow(r).height = r === 2 ? 26 : 14;
    for (let c = 1; c <= columnas; c++) ws.getCell(r, c).fill = relleno(MARCA.verde);
  }
  ws.addImage(logoId, { tl: { col: 0.15, row: 0.6 }, ext: { width: 190, height: 40 } });
  const t = ws.getCell(2, columnas);
  t.value = titulo.toUpperCase();
  t.font = { name: FUENTE, bold: true, size: 11, color: { argb: argb(MARCA.amarillo) } };
  t.alignment = { horizontal: "right", vertical: "middle" };
  const p = ws.getCell(3, columnas);
  p.value = periodo;
  p.font = { name: FUENTE, size: 9, color: { argb: argb(MARCA.crema) } };
  p.alignment = { horizontal: "right", vertical: "top" };
}

function encabezadoTabla(ws: ExcelJS.Worksheet, fila: number, titulos: string[], izquierda: number) {
  const r = ws.getRow(fila);
  titulos.forEach((t, i) => {
    const c = r.getCell(i + 1);
    c.value = t;
    c.font = { name: FUENTE, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = relleno(MARCA.verdeOscuro);
    c.alignment = { vertical: "middle", horizontal: i < izquierda ? "left" : "center", wrapText: true };
    c.border = { bottom: { style: "thin", color: { argb: argb(MARCA.verde) } } };
  });
  r.height = 22;
}

function filaTotal(ws: ExcelJS.Worksheet, fila: number, columnas: number, valores: Record<number, ExcelJS.CellValue>, formatos: Record<number, string>) {
  const r = ws.getRow(fila);
  r.getCell(1).value = "Total";
  for (const [c, v] of Object.entries(valores)) r.getCell(Number(c)).value = v;
  for (const [c, f] of Object.entries(formatos)) r.getCell(Number(c)).numFmt = f;
  for (let c = 1; c <= columnas; c++) {
    const cell = r.getCell(c);
    cell.font = { name: FUENTE, bold: true, color: { argb: argb(MARCA.verdeOscuro) } };
    cell.fill = relleno(MARCA.verdeClaro);
    cell.alignment = { horizontal: c === 1 ? "left" : "center" };
    cell.border = { top: { style: "thin", color: { argb: argb(MARCA.verde) } } };
  }
}

interface Item { d: DatosExportacion; inf: Informe }

/** Hoja "Detalle diario". Con `conEmpleado` añade Empleado y Centro como primeras columnas. Devuelve la última fila de datos. */
function hojaDetalle(wb: ExcelJS.Workbook, items: Item[], conEmpleado: boolean, periodo: string, pie: string, logoId: number) {
  const ws = wb.addWorksheet("Detalle diario", { views: [{ state: "frozen", ySplit: 5, xSplit: conEmpleado ? 1 : 0, showGridLines: false }] });
  const o = conEmpleado ? 2 : 0;
  const cols = [...(conEmpleado ? ["Empleado/a", "Centro / Departamento"] : []), "Fecha", "Día", "Entrada", "Salida", "Nº fichajes", "Pausas", "Trabajado", "Justificado", "Ubicación", "Incidencias"];
  ws.columns = [...(conEmpleado ? [{ width: 28 }, { width: 26 }] : []), { width: 12 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 11 }, { width: 44 }];
  cabecera(ws, cols.length, "Detalle diario", periodo, logoId);
  encabezadoTabla(ws, 5, cols, 2 + o);
  let fila = 6;
  for (const { inf } of items) {
    for (const x of inf.dias) {
      const r = ws.getRow(fila++);
      r.values = [
        ...(conEmpleado ? [inf.nombreCompleto, inf.centro] : []),
        fechaExcel(x.fecha),
        x.diaSemana,
        horaExcel(x.entrada),
        horaExcel(x.salida),
        x.numFichajes || null,
        minExcel(x.minutosPausa),
        minExcel(x.minutosTrabajados),
        minExcel(x.minutosJustificados),
        x.ubicacion || null,
        x.incidencias || null,
      ];
      r.getCell(1 + o).numFmt = "dd/mm/yyyy";
      [3 + o, 4 + o].forEach((c) => (r.getCell(c).numFmt = "hh:mm"));
      [6 + o, 7 + o, 8 + o].forEach((c) => (r.getCell(c).numFmt = '[h]:mm;;"—"'));
      r.eachCell({ includeEmpty: true }, (c, n) => {
        const k = n - o;
        c.font = { name: FUENTE, size: 10, bold: k === 7, color: { argb: argb(k === 10 ? (x.hayIncidencia ? MARCA.rojo : MARCA.gris) : k === 2 ? MARCA.gris : MARCA.negro) } };
        c.alignment = { horizontal: k <= 2 || k === 10 ? "left" : "center", vertical: "middle" };
        c.border = bordeFila;
        if (x.finDeSemana) c.fill = relleno(MARCA.grisClaro);
      });
    }
  }
  const ultima = fila - 1;
  const [cN, cP, cT, cJ] = [5 + o, 6 + o, 7 + o, 8 + o].map(col);
  const tot = items.reduce((s, i) => ({ f: s.f + i.inf.fichajes.length, p: s.p + i.inf.totalPausa, t: s.t + i.inf.totalMinutos, j: s.j + i.inf.totalJustificado }), { f: 0, p: 0, t: 0, j: 0 });
  filaTotal(
    ws,
    fila,
    cols.length,
    {
      [5 + o]: { formula: `SUM(${cN}6:${cN}${ultima})`, result: tot.f },
      [6 + o]: { formula: `SUM(${cP}6:${cP}${ultima})`, result: minExcel(tot.p) },
      [7 + o]: { formula: `SUM(${cT}6:${cT}${ultima})`, result: minExcel(tot.t) },
      [8 + o]: { formula: `SUM(${cJ}6:${cJ}${ultima})`, result: minExcel(tot.j) },
    },
    { [6 + o]: "[h]:mm", [7 + o]: "[h]:mm", [8 + o]: "[h]:mm" }
  );
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: ultima, column: cols.length } };
  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "5:5" };
  ws.headerFooter.oddFooter = `&L&8${pie}&R&8Página &P de &N`;
  return { ultima, cP, cT };
}

/** Hoja "Fichajes" (sin coordenadas). */
function hojaFichajes(wb: ExcelJS.Workbook, items: Item[], conEmpleado: boolean, periodo: string, logoId: number) {
  const ws = wb.addWorksheet("Fichajes", { views: [{ state: "frozen", ySplit: 5, showGridLines: false }] });
  const o = conEmpleado ? 2 : 0;
  const cols = [...(conEmpleado ? ["Empleado/a", "Centro / Departamento"] : []), "Fecha", "Hora", "Tipo", "Ubicación en el momento del fichaje"];
  ws.columns = [...(conEmpleado ? [{ width: 28 }, { width: 26 }] : []), { width: 12 }, { width: 9 }, { width: 38 }, { width: 40 }];
  cabecera(ws, cols.length, "Fichajes", periodo, logoId);
  encabezadoTabla(ws, 5, cols, cols.length);
  let fila = 6;
  for (const { d, inf } of items) {
    d.fichajes.forEach((f, i) => {
      const p = partes(f.fechaHoraUtc);
      const x = inf.fichajes[i];
      const r = ws.getRow(fila++);
      r.values = [...(conEmpleado ? [inf.nombreCompleto, inf.centro] : []), fechaExcel(p.fecha), horaExcel(p.hora), x.tipo, x.ubicacion];
      r.getCell(1 + o).numFmt = "dd/mm/yyyy";
      r.getCell(2 + o).numFmt = "hh:mm";
      r.eachCell((c, n) => {
        const sinUbi = n === 4 + o && !x.ubicacion.startsWith("Sí") && !x.ubicacion.startsWith("—");
        c.font = { name: FUENTE, size: 10, color: { argb: argb(sinUbi ? MARCA.rojo : n === 3 + o && x.marcado ? MARCA.verdeOscuro : MARCA.negro) } };
        c.alignment = { horizontal: n === 2 + o ? "center" : "left" };
        c.border = bordeFila;
      });
    });
  }
  if (fila > 6) ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: fila - 1, column: cols.length } };
  ws.pageSetup = { paperSize: 9, orientation: conEmpleado ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "5:5" };
}

function textoLegal(ws: ExcelJS.Worksheet, fila: number, columnas: number, extra = "") {
  ws.mergeCells(fila, 1, fila + 2, columnas);
  const leg = ws.getCell(fila, 1);
  leg.value = TEXTO_LEGAL + extra;
  leg.font = { name: FUENTE, size: 8, italic: true, color: { argb: argb(MARCA.gris) } };
  leg.alignment = { wrapText: true, vertical: "top" };
}

export async function exportarExcel(entrada: DatosExportacion | DatosExportacion[]) {
  const lista = Array.isArray(entrada) ? entrada : [entrada];
  if (!lista.length) return;
  const items: Item[] = lista.map((d) => ({ d, inf: prepararInforme(d) }));
  const equipo = items.length > 1;
  const periodo = items[0].inf.periodo;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Registro de Jornada · Grupo Arquisocial";
  wb.company = "Grupo Arquisocial";
  wb.title = equipo ? `Registro de jornada · ${items.length} empleados · ${periodo}` : `Registro de jornada · ${items[0].inf.nombreCompleto} · ${periodo}`;
  wb.created = new Date(lista[0].generadoUtc);
  const logo = await logoPng(120);
  const logoId = wb.addImage({ base64: logo.dataUrl, extension: "png" });
  const exportadoPor = lista[0].exportadoPor;

  if (!equipo) {
    // ================= Resumen (un empleado) =================
    const { d, inf } = items[0];
    const rs = wb.addWorksheet("Resumen", { views: [{ showGridLines: false }], properties: { tabColor: { argb: argb(MARCA.verde) } } });
    rs.columns = [{ width: 30 }, { width: 46 }];
    cabecera(rs, 2, "Registro de jornada", periodo, logoId);
    const ultima = 5 + inf.dias.length;
    const datos: [string, ExcelJS.CellValue, string?][] = [
      ["Empleado/a", inf.nombreCompleto],
      ["Correo electrónico", d.empleado.email],
      ["Empresa", d.empleado.empresa],
      ["Centro / Departamento", inf.centro],
      ["Periodo", periodo],
      ["", ""],
      ["Horas trabajadas", { formula: `SUM('Detalle diario'!G6:G${ultima})`, result: minExcel(inf.totalMinutos) }, "[h]:mm"],
      ["Tiempo en pausa", { formula: `SUM('Detalle diario'!F6:F${ultima})`, result: minExcel(inf.totalPausa) }, "[h]:mm"],
      ["Horas justificadas (ausencias)", { formula: `SUM('Detalle diario'!H6:H${ultima})`, result: minExcel(inf.totalJustificado) }, "[h]:mm"],
      ["Días con jornada", inf.diasTrabajados],
      ["Media por día trabajado", minExcel(inf.mediaMinutos), "[h]:mm"],
      ["Días con incidencias", inf.numIncidencias],
      ["Fichajes registrados", inf.fichajes.length],
      ["", ""],
      ["Generado el", inf.generado],
      ...(exportadoPor ? [["Exportado por", exportadoPor] as [string, string]] : []),
      ["Código de verificación", d.codigo],
    ];
    datos.forEach(([etq, val, fmt], i) => {
      const r = rs.getRow(5 + i);
      r.height = 19;
      const a = r.getCell(1);
      const b = r.getCell(2);
      a.value = etq;
      b.value = val;
      if (!etq) return;
      a.font = { name: FUENTE, size: 10, color: { argb: argb(MARCA.gris) } };
      b.font = { name: FUENTE, size: 11, bold: true, color: { argb: argb(etq === "Días con incidencias" && inf.numIncidencias ? MARCA.rojo : MARCA.negro) } };
      b.alignment = { horizontal: "left" };
      if (fmt) b.numFmt = fmt;
      a.border = bordeFila;
      b.border = bordeFila;
      if (i >= 6 && i <= 12) b.fill = relleno(MARCA.verdeClaro);
    });
    textoLegal(rs, 5 + datos.length + 1, 2);
    rs.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
    rs.headerFooter.oddFooter = `&L&8Grupo Arquisocial · Código ${d.codigo}&R&8Página &P de &N`;
    hojaDetalle(wb, items, false, periodo, `${inf.nombreCompleto} · ${periodo}`, logoId);
    hojaFichajes(wb, items, false, periodo, logoId);
  } else {
    // ================= Resumen equipo =================
    const rs = wb.addWorksheet("Resumen equipo", { views: [{ state: "frozen", ySplit: 5, showGridLines: false }], properties: { tabColor: { argb: argb(MARCA.verde) } } });
    const cols = ["Empleado/a", "Centro / Departamento", "Empresa", "Horas trabajadas", "Pausas", "Días con jornada", "Media por día", "Días con incidencias", "Fichajes", "Código de verificación"];
    rs.columns = [{ width: 28 }, { width: 26 }, { width: 16 }, { width: 12 }, { width: 10 }, { width: 11 }, { width: 11 }, { width: 12 }, { width: 10 }, { width: 22 }];
    cabecera(rs, cols.length, "Registro de jornada · Equipo", periodo, logoId);
    encabezadoTabla(rs, 5, cols, 3);
    items.forEach(({ d, inf }, i) => {
      const r = rs.getRow(6 + i);
      r.values = [inf.nombreCompleto, inf.centro, d.empleado.empresa, minExcel(inf.totalMinutos), minExcel(inf.totalPausa), inf.diasTrabajados, minExcel(inf.mediaMinutos), inf.numIncidencias, inf.fichajes.length, d.codigo];
      [4, 5, 7].forEach((c) => (r.getCell(c).numFmt = '[h]:mm;;"—"'));
      r.eachCell({ includeEmpty: true }, (c, n) => {
        c.font = { name: FUENTE, size: 10, bold: n === 4, color: { argb: argb(n === 8 && inf.numIncidencias ? MARCA.rojo : n === 10 ? MARCA.verdeOscuro : MARCA.negro) } };
        c.alignment = { horizontal: n <= 3 ? "left" : "center", vertical: "middle" };
        c.border = bordeFila;
      });
    });
    const ultima = 5 + items.length;
    const sum = (c: string) => ({ formula: `SUM(${c}6:${c}${ultima})` });
    filaTotal(
      rs,
      ultima + 1,
      cols.length,
      {
        4: { ...sum("D"), result: minExcel(items.reduce((s, x) => s + x.inf.totalMinutos, 0)) },
        5: { ...sum("E"), result: minExcel(items.reduce((s, x) => s + x.inf.totalPausa, 0)) },
        6: { ...sum("F"), result: items.reduce((s, x) => s + x.inf.diasTrabajados, 0) },
        8: { ...sum("H"), result: items.reduce((s, x) => s + x.inf.numIncidencias, 0) },
        9: { ...sum("I"), result: items.reduce((s, x) => s + x.inf.fichajes.length, 0) },
      },
      { 4: "[h]:mm", 5: "[h]:mm" }
    );
    rs.autoFilter = { from: { row: 5, column: 1 }, to: { row: ultima, column: cols.length } };
    const info = rs.getRow(ultima + 3);
    info.getCell(1).value = `Generado el ${items[0].inf.generado}${exportadoPor ? ` por ${exportadoPor}` : ""} · ${items.length} empleados. Cada empleado tiene su propio código de verificación.`;
    info.getCell(1).font = { name: FUENTE, size: 9, color: { argb: argb(MARCA.gris) } };
    textoLegal(rs, ultima + 5, cols.length);
    rs.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "5:5" };
    rs.headerFooter.oddFooter = `&L&8Grupo Arquisocial · Registro de jornada · ${periodo}&R&8Página &P de &N`;
    hojaDetalle(wb, items, true, periodo, `Equipo · ${periodo}`, logoId);
    hojaFichajes(wb, items, true, periodo, logoId);
  }

  const buf = await wb.xlsx.writeBuffer();
  const nombre = equipo ? nombreArchivoEquipo(lista[0].desde, lista[0].hasta, items.length) : items[0].inf.nombreArchivo;
  descargar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${nombre}.xlsx`);
}

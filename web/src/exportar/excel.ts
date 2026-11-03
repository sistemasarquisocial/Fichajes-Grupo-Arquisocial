import ExcelJS from "exceljs";
import { DatosExportacion } from "../api";
import { descargar, Informe, logoPng, MARCA, partes, prepararInforme, TEXTO_LEGAL } from "./comun";

/* Libro Excel con la identidad de Grupo Arquisocial: Resumen · Detalle diario · Fichajes. */

const argb = (c: string) => "FF" + c.replace("#", "").toUpperCase();
const relleno = (c: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(c) } });
const FUENTE = "Calibri";

/** Fecha como serial de Excel sin desfase horario (la hora mostrada es la de Madrid). */
const fechaExcel = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00Z`);
/** Hora "HH:MM" o minutos como fracción de día, para que Excel pueda sumar. */
const horaExcel = (hhmm: string) => (hhmm ? (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))) / 1440 : null);
const minExcel = (min: number) => min / 1440;

async function cabecera(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, columnas: number, titulo: string, inf: Informe, logoId: number) {
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
  p.value = inf.periodo;
  p.font = { name: FUENTE, size: 9, color: { argb: argb(MARCA.crema) } };
  p.alignment = { horizontal: "right", vertical: "top" };
}

function encabezadoTabla(ws: ExcelJS.Worksheet, fila: number, titulos: string[]) {
  const r = ws.getRow(fila);
  titulos.forEach((t, i) => {
    const c = r.getCell(i + 1);
    c.value = t;
    c.font = { name: FUENTE, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = relleno(MARCA.verdeOscuro);
    c.alignment = { vertical: "middle", horizontal: i < 2 ? "left" : "center", wrapText: true };
    c.border = { bottom: { style: "thin", color: { argb: argb(MARCA.verde) } } };
  });
  r.height = 22;
}

export async function exportarExcel(d: DatosExportacion) {
  const inf = prepararInforme(d);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Fichajes · Grupo Arquisocial";
  wb.company = "Grupo Arquisocial";
  wb.title = `Registro de jornada · ${inf.nombreCompleto} · ${inf.periodo}`;
  wb.created = new Date(d.generadoUtc);
  const logo = await logoPng(120);
  const logoId = wb.addImage({ base64: logo.dataUrl, extension: "png" });
  const bordeFila = { bottom: { style: "hair" as const, color: { argb: "FFDDE1D9" } } };

  // ================= Resumen =================
  const rs = wb.addWorksheet("Resumen", { views: [{ showGridLines: false }], properties: { tabColor: { argb: argb(MARCA.verde) } } });
  rs.columns = [{ width: 30 }, { width: 46 }];
  await cabecera(wb, rs, 2, "Registro de jornada", inf, logoId);
  const datos: [string, ExcelJS.CellValue, string?][] = [
    ["Empleado/a", inf.nombreCompleto],
    ["Correo electrónico", d.empleado.email],
    ["Empresa", d.empleado.empresa],
    ["Centro de trabajo", inf.centro],
    ["Periodo", inf.periodo],
    ["", ""],
    ["Horas trabajadas", { formula: `SUM('Detalle diario'!G6:G${5 + inf.dias.length})`, result: minExcel(inf.totalMinutos) }, "[h]:mm"],
    ["Tiempo en pausa", { formula: `SUM('Detalle diario'!F6:F${5 + inf.dias.length})`, result: minExcel(inf.totalPausa) }, "[h]:mm"],
    ["Días con jornada", inf.diasTrabajados],
    ["Media por día trabajado", minExcel(inf.mediaMinutos), "[h]:mm"],
    ["Días con incidencias", inf.numIncidencias],
    ["Fichajes registrados", inf.fichajes.length],
    ["", ""],
    ["Generado el", inf.generado],
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
    if (i >= 6 && i <= 11) b.fill = relleno(MARCA.verdeClaro);
  });
  const leg = rs.getCell(5 + datos.length + 1, 1);
  rs.mergeCells(5 + datos.length + 1, 1, 5 + datos.length + 3, 2);
  leg.value = TEXTO_LEGAL;
  leg.font = { name: FUENTE, size: 8, italic: true, color: { argb: argb(MARCA.gris) } };
  leg.alignment = { wrapText: true, vertical: "top" };
  rs.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
  rs.headerFooter.oddFooter = `&L&8Grupo Arquisocial · Código ${d.codigo}&R&8Página &P de &N`;

  // ================= Detalle diario =================
  const dd = wb.addWorksheet("Detalle diario", { views: [{ state: "frozen", ySplit: 5, showGridLines: false }] });
  const colsD = ["Fecha", "Día", "Entrada", "Salida", "Nº fichajes", "Pausas", "Trabajado", "Ubicación", "Incidencias"];
  dd.columns = [{ width: 12 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 10 }, { width: 12 }, { width: 11 }, { width: 44 }];
  await cabecera(wb, dd, colsD.length, "Detalle diario", inf, logoId);
  encabezadoTabla(dd, 5, colsD);
  inf.dias.forEach((x, i) => {
    const r = dd.getRow(6 + i);
    r.values = [
      fechaExcel(x.fecha),
      x.diaSemana,
      horaExcel(x.entrada),
      horaExcel(x.salida),
      x.numFichajes || null,
      minExcel(x.minutosPausa),
      minExcel(x.minutosTrabajados),
      x.ubicacion || null,
      x.incidencias || null,
    ];
    r.getCell(1).numFmt = "dd/mm/yyyy";
    [3, 4].forEach((c) => (r.getCell(c).numFmt = "hh:mm"));
    [6, 7].forEach((c) => (r.getCell(c).numFmt = "[h]:mm;;\"—\""));
    r.eachCell({ includeEmpty: true }, (c, n) => {
      c.font = { name: FUENTE, size: 10, bold: n === 7, color: { argb: argb(n === 9 ? MARCA.rojo : n === 2 ? MARCA.gris : MARCA.negro) } };
      c.alignment = { horizontal: n <= 2 || n === 9 ? "left" : "center", vertical: "middle" };
      c.border = bordeFila;
      if (x.finDeSemana) c.fill = relleno(MARCA.grisClaro);
    });
  });
  const ft = 6 + inf.dias.length;
  const tot = dd.getRow(ft);
  tot.getCell(1).value = "Total";
  tot.getCell(5).value = { formula: `SUM(E6:E${ft - 1})`, result: inf.fichajes.length };
  tot.getCell(6).value = { formula: `SUM(F6:F${ft - 1})`, result: minExcel(inf.totalPausa) };
  tot.getCell(7).value = { formula: `SUM(G6:G${ft - 1})`, result: minExcel(inf.totalMinutos) };
  [6, 7].forEach((c) => (tot.getCell(c).numFmt = "[h]:mm"));
  for (let c = 1; c <= colsD.length; c++) {
    const cell = tot.getCell(c);
    cell.font = { name: FUENTE, bold: true, color: { argb: argb(MARCA.verdeOscuro) } };
    cell.fill = relleno(MARCA.verdeClaro);
    cell.alignment = { horizontal: c <= 2 ? "left" : "center" };
    cell.border = { top: { style: "thin", color: { argb: argb(MARCA.verde) } } };
  }
  dd.autoFilter = { from: { row: 5, column: 1 }, to: { row: ft - 1, column: colsD.length } };
  dd.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "5:5" };
  dd.headerFooter.oddFooter = `&L&8${inf.nombreCompleto} · ${inf.periodo}&R&8Página &P de &N`;

  // ================= Fichajes =================
  const fs = wb.addWorksheet("Fichajes", { views: [{ state: "frozen", ySplit: 5, showGridLines: false }] });
  const colsF = ["Fecha", "Hora", "Tipo", "Ubicación en el momento del fichaje"];
  fs.columns = [{ width: 12 }, { width: 9 }, { width: 16 }, { width: 40 }];
  await cabecera(wb, fs, colsF.length, "Fichajes", inf, logoId);
  encabezadoTabla(fs, 5, colsF);
  d.fichajes.forEach((f, i) => {
    const p = partes(f.fechaHoraUtc);
    const x = inf.fichajes[i];
    const r = fs.getRow(6 + i);
    r.values = [fechaExcel(p.fecha), horaExcel(p.hora), x.tipo, x.ubicacion];
    r.getCell(1).numFmt = "dd/mm/yyyy";
    r.getCell(2).numFmt = "hh:mm";
    r.eachCell((c, n) => {
      c.font = { name: FUENTE, size: 10, color: { argb: argb(n === 4 && !x.ubicacion.startsWith("Sí") ? MARCA.rojo : MARCA.negro) } };
      c.alignment = { horizontal: n === 2 ? "center" : "left" };
      c.border = bordeFila;
    });
  });
  if (d.fichajes.length) fs.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + d.fichajes.length, column: colsF.length } };
  fs.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "5:5" };

  const buf = await wb.xlsx.writeBuffer();
  descargar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${inf.nombreArchivo}.xlsx`);
}

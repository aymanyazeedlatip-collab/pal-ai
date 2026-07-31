/* PAL-AI Long-Term Planting Calendar PDF Generator
   Self-contained: no external PDF library or online dependency is required. */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;
  const PAGE_WIDTH = 841.89;
  const PAGE_HEIGHT = 595.28;
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const CROP_LABELS = {
    inbred: 'Inbred Lowland Rice',
    hybrid: 'Hybrid Rice',
    glutinous: 'Glutinous Rice',
    aromatic: 'Aromatic Rice',
    rainfed: 'Rain-fed Lowland Rice',
    upland: 'Upland Rice',
    'direct-seeded': 'Direct-seeded Rice',
    transplanted: 'Transplanted Rice'
  };

  const PHASE_COLORS = {
    planting: '#166534',
    establishment: '#22c55e',
    vegetative: '#84cc16',
    panicle: '#eab308',
    flowering: '#f59e0b',
    grain: '#d97706',
    harvest: '#92400e'
  };

  function parseIsoUtc(iso) {
    if (!iso) return null;
    const date = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addUtcDays(date, days) {
    return new Date(date.getTime() + Number(days) * DAY_MS);
  }

  function toIsoUtc(date) {
    return date.toISOString().slice(0, 10);
  }

  function formatDate(date, includeYear = true) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: includeYear ? 'numeric' : undefined,
      timeZone: 'UTC'
    });
  }

  function formatRange(startDate, endDate, includeYear = true) {
    if (!startDate || !endDate) return '-';
    const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
    const sameMonth = sameYear && startDate.getUTCMonth() === endDate.getUTCMonth();

    if (sameMonth) {
      const month = startDate.toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' });
      return includeYear
        ? `${month} ${startDate.getUTCDate()}-${endDate.getUTCDate()}, ${startDate.getUTCFullYear()}`
        : `${month} ${startDate.getUTCDate()}-${endDate.getUTCDate()}`;
    }

    const startLabel = formatDate(startDate, includeYear && !sameYear);
    const endLabel = formatDate(endDate, includeYear);
    return `${startLabel} - ${endLabel}`;
  }

  function buildPhaseSchedule(input) {
    const startDate = parseIsoUtc(input?.bestStartISO);
    const endDate = parseIsoUtc(input?.bestEndISO);
    const maturityDays = Math.max(90, Number(input?.maturityDays || 115));
    if (!startDate || !endDate) return [];

    const establishmentEnd = Math.max(18, Math.round(maturityDays * 0.18));
    const vegetativeEnd = Math.round(maturityDays * 0.45);
    const panicleEnd = Math.round(maturityDays * 0.62);
    const floweringEnd = Math.round(maturityDays * 0.72);
    const grainEnd = Math.round(maturityDays * 0.90);

    const definitions = [
      {
        key: 'planting',
        title: 'Planting Window',
        shortTitle: 'Planting',
        startOffset: 0,
        endOffset: 0,
        description: 'Land preparation, sowing or transplanting, and initial irrigation.'
      },
      {
        key: 'establishment',
        title: 'Seedling Establishment',
        shortTitle: 'Establishment',
        startOffset: 7,
        endOffset: establishmentEnd,
        description: 'Root anchoring, seedling recovery, and early stand establishment.'
      },
      {
        key: 'vegetative',
        title: 'Tillering and Vegetative Growth',
        shortTitle: 'Vegetative',
        startOffset: establishmentEnd + 1,
        endOffset: vegetativeEnd,
        description: 'Tillering, canopy expansion, sunlight capture, and nutrient uptake.'
      },
      {
        key: 'panicle',
        title: 'Panicle Initiation and Booting',
        shortTitle: 'Panicle',
        startOffset: vegetativeEnd + 1,
        endOffset: panicleEnd,
        description: 'Panicle formation and preparation for the reproductive stage.'
      },
      {
        key: 'flowering',
        title: 'Flowering',
        shortTitle: 'Flowering',
        startOffset: panicleEnd + 1,
        endOffset: floweringEnd,
        description: 'Pollination period; especially sensitive to heat, storms, and water stress.'
      },
      {
        key: 'grain',
        title: 'Grain Filling',
        shortTitle: 'Grain Filling',
        startOffset: floweringEnd + 1,
        endOffset: grainEnd,
        description: 'Kernel development, starch accumulation, and grain-weight formation.'
      },
      {
        key: 'harvest',
        title: 'Ripening and Harvest',
        shortTitle: 'Harvest',
        startOffset: grainEnd + 1,
        endOffset: maturityDays,
        description: 'Final ripening, field dry-down, and the projected harvest period.'
      }
    ];

    return definitions.map((phase, index) => {
      const phaseStart = phase.key === 'planting' ? startDate : addUtcDays(startDate, phase.startOffset);
      const phaseEnd = phase.key === 'planting' ? endDate : addUtcDays(endDate, phase.endOffset);
      return {
        ...phase,
        number: index + 1,
        color: PHASE_COLORS[phase.key],
        startISO: toIsoUtc(phaseStart),
        endISO: toIsoUtc(phaseEnd),
        dateRange: formatRange(phaseStart, phaseEnd, true),
        startDate: phaseStart,
        endDate: phaseEnd
      };
    });
  }

  function sanitizePdfText(value) {
    return String(value ?? '')
      .replace(/[–—]/g, '-')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/•/g, '-')
      .replace(/×/g, 'x')
      .replace(/°/g, ' deg ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapePdfString(value) {
    return sanitizePdfText(value)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function hexToRgb(hex) {
    const clean = String(hex || '#000000').replace('#', '');
    const expanded = clean.length === 3 ? clean.split('').map(char => char + char).join('') : clean.padEnd(6, '0');
    return [
      parseInt(expanded.slice(0, 2), 16) / 255,
      parseInt(expanded.slice(2, 4), 16) / 255,
      parseInt(expanded.slice(4, 6), 16) / 255
    ];
  }

  function approximateTextWidth(text, fontSize, bold = false) {
    return sanitizePdfText(text).length * fontSize * (bold ? 0.54 : 0.50);
  }

  function wrapText(text, maxWidth, fontSize, bold = false) {
    const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let line = '';
    words.forEach(word => {
      const candidate = line ? `${line} ${word}` : word;
      if (line && approximateTextWidth(candidate, fontSize, bold) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  class PdfCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.commands = [];
    }

    colorCommand(hex, stroke = false) {
      const [r, g, b] = hexToRgb(hex);
      return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} ${stroke ? 'RG' : 'rg'}`;
    }

    rect(x, top, width, height, options = {}) {
      const y = this.height - top - height;
      if (options.fill) this.commands.push(this.colorCommand(options.fill));
      if (options.stroke) this.commands.push(this.colorCommand(options.stroke, true));
      if (options.lineWidth) this.commands.push(`${Number(options.lineWidth).toFixed(2)} w`);
      this.commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${options.fill && options.stroke ? 'B' : options.fill ? 'f' : 'S'}`);
    }

    line(x1, top1, x2, top2, color = '#CBD5E1', lineWidth = 1) {
      this.commands.push(this.colorCommand(color, true));
      this.commands.push(`${lineWidth.toFixed(2)} w`);
      this.commands.push(`${x1.toFixed(2)} ${(this.height - top1).toFixed(2)} m ${x2.toFixed(2)} ${(this.height - top2).toFixed(2)} l S`);
    }

    circle(cx, topCenter, radius, fill, stroke = null) {
      const cy = this.height - topCenter;
      const k = 0.5522847498;
      const c = radius * k;
      if (fill) this.commands.push(this.colorCommand(fill));
      if (stroke) this.commands.push(this.colorCommand(stroke, true));
      this.commands.push([
        `${(cx + radius).toFixed(2)} ${cy.toFixed(2)} m`,
        `${(cx + radius).toFixed(2)} ${(cy + c).toFixed(2)} ${(cx + c).toFixed(2)} ${(cy + radius).toFixed(2)} ${cx.toFixed(2)} ${(cy + radius).toFixed(2)} c`,
        `${(cx - c).toFixed(2)} ${(cy + radius).toFixed(2)} ${(cx - radius).toFixed(2)} ${(cy + c).toFixed(2)} ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} c`,
        `${(cx - radius).toFixed(2)} ${(cy - c).toFixed(2)} ${(cx - c).toFixed(2)} ${(cy - radius).toFixed(2)} ${cx.toFixed(2)} ${(cy - radius).toFixed(2)} c`,
        `${(cx + c).toFixed(2)} ${(cy - radius).toFixed(2)} ${(cx + radius).toFixed(2)} ${(cy - c).toFixed(2)} ${(cx + radius).toFixed(2)} ${cy.toFixed(2)} c`,
        fill && stroke ? 'B' : fill ? 'f' : 'S'
      ].join('\n'));
    }

    text(value, x, top, size = 10, options = {}) {
      const clean = sanitizePdfText(value);
      if (!clean) return;
      const bold = Boolean(options.bold);
      const font = bold ? 'F2' : 'F1';
      let drawX = x;
      const width = approximateTextWidth(clean, size, bold);
      if (options.align === 'center') drawX -= width / 2;
      if (options.align === 'right') drawX -= width;
      this.commands.push(this.colorCommand(options.color || '#0F172A'));
      this.commands.push(`BT /${font} ${size.toFixed(2)} Tf ${drawX.toFixed(2)} ${(this.height - top - size).toFixed(2)} Td (${escapePdfString(clean)}) Tj ET`);
    }

    wrappedText(value, x, top, maxWidth, size = 9, options = {}) {
      const lines = wrapText(value, maxWidth, size, Boolean(options.bold));
      const lineHeight = options.lineHeight || size * 1.28;
      lines.slice(0, options.maxLines || 99).forEach((line, index) => {
        this.text(line, x, top + index * lineHeight, size, options);
      });
      return top + lines.length * lineHeight;
    }
  }

  function buildPdfBytes(contentStreams) {
    const encoder = new TextEncoder();
    const streams = Array.isArray(contentStreams) ? contentStreams : [contentStreams];
    const pageCount = Math.max(1, streams.length);
    const pagesObjectNumber = 2;
    const firstPageObjectNumber = 3;
    const firstContentObjectNumber = firstPageObjectNumber + pageCount;
    const font1ObjectNumber = firstContentObjectNumber + pageCount;
    const font2ObjectNumber = font1ObjectNumber + 1;
    const lastObjectNumber = font2ObjectNumber;
    const objects = new Array(lastObjectNumber + 1);

    objects[1] = `<< /Type /Catalog /Pages ${pagesObjectNumber} 0 R >>`;
    const kids = Array.from({ length: pageCount }, (_, index) => `${firstPageObjectNumber + index} 0 R`).join(' ');
    objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;

    streams.forEach((contentStream, index) => {
      const content = String(contentStream || '');
      const streamLength = encoder.encode(content).length;
      const pageObjectNumber = firstPageObjectNumber + index;
      const contentObjectNumber = firstContentObjectNumber + index;
      objects[pageObjectNumber] = `<< /Type /Page /Parent ${pagesObjectNumber} 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] /Resources << /Font << /F1 ${font1ObjectNumber} 0 R /F2 ${font2ObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
      objects[contentObjectNumber] = `<< /Length ${streamLength} >>\nstream\n${content}\nendstream`;
    });

    objects[font1ObjectNumber] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[font2ObjectNumber] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    const chunks = [];
    const offsets = [0];
    const header = encoder.encode('%PDF-1.4\n%PALAI\n');
    chunks.push(header);
    let totalLength = header.length;

    for (let objectNumber = 1; objectNumber <= lastObjectNumber; objectNumber++) {
      offsets.push(totalLength);
      const bytes = encoder.encode(`${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`);
      chunks.push(bytes);
      totalLength += bytes.length;
    }

    const xrefOffset = totalLength;
    let xref = `xref\n0 ${lastObjectNumber + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= lastObjectNumber; i++) {
      xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${lastObjectNumber + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    const xrefBytes = encoder.encode(xref);
    chunks.push(xrefBytes);
    totalLength += xrefBytes.length;

    const output = new Uint8Array(totalLength);
    let position = 0;
    chunks.forEach(chunk => {
      output.set(chunk, position);
      position += chunk.length;
    });
    return output;
  }

  function getRiskColor(score) {
    const value = Number(score || 0);
    if (value >= 85) return '#15803D';
    if (value >= 70) return '#65A30D';
    if (value >= 55) return '#CA8A04';
    if (value >= 40) return '#EA580C';
    return '#DC2626';
  }


  function cleanLocationValue(value) {
    const clean = sanitizePdfText(value || '');
    if (!clean || /^(select|loading|could not|no local)/i.test(clean)) return '';
    return clean;
  }

  function getPdfLocationDetails(metadata = {}) {
    const regionName = cleanLocationValue(metadata.regionName) || 'Selected PAL-AI Region';
    const provinceName = cleanLocationValue(metadata.provinceName);
    const municipalityName = cleanLocationValue(metadata.municipalityName);
    const barangayName = cleanLocationValue(metadata.barangayName);

    const detailedParts = [];
    if (barangayName) detailedParts.push(/^barangay/i.test(barangayName) ? barangayName : `Barangay: ${barangayName}`);
    if (municipalityName) detailedParts.push(`Municipality/City: ${municipalityName}`);
    if (provinceName) detailedParts.push(`Province: ${provinceName}`);

    const fallbackLocation = cleanLocationValue(metadata.locationLabel);
    return {
      regionName,
      detailedLocation: detailedParts.join('  |  ') || fallbackLocation || regionName,
      fullLocation: detailedParts.length ? `${detailedParts.join(', ')}, ${regionName}` : fallbackLocation || regionName
    };
  }

  function drawSummaryCard(canvas, x, y, width, label, value, accent) {
    canvas.rect(x, y, width, 53, { fill: '#FFFFFF', stroke: '#DDE7DD', lineWidth: 0.8 });
    canvas.rect(x, y, 5, 53, { fill: accent });
    canvas.text(label.toUpperCase(), x + 14, y + 10, 7.5, { bold: true, color: '#64748B' });
    canvas.wrappedText(value, x + 14, y + 24, width - 25, 11, { bold: true, color: '#173A24', maxLines: 2, lineHeight: 12.5 });
  }

  function drawMonthCalendar(canvas, monthItem, x, y, width, height) {
    const year = Number(monthItem.year);
    const monthIndex = Number(monthItem.monthIndex);
    const scoreColor = getRiskColor(monthItem.score);
    const bestStart = Number(monthItem.bestStartDay);
    const bestEnd = Number(monthItem.bestEndDay);
    const bestDay = Number(monthItem.bestDay);
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();

    canvas.rect(x, y, width, height, { fill: '#FFFFFF', stroke: '#DDE7DD', lineWidth: 0.9 });
    canvas.text(`${MONTH_NAMES[monthIndex]} ${year}`, x + 16, y + 15, 18, { bold: true, color: '#173A24' });
    canvas.text('Highlighted dates are the recommended planting window.', x + 16, y + 39, 8.5, { color: '#64748B' });

    const gridX = x + 14;
    const gridY = y + 66;
    const gridW = width - 28;
    const columnW = gridW / 7;
    const rowH = 38;

    WEEKDAY_NAMES.forEach((day, index) => {
      canvas.text(day, gridX + index * columnW + columnW / 2, gridY, 8, { bold: true, color: '#64748B', align: 'center' });
    });

    const cellTop = gridY + 20;
    for (let row = 0; row < 6; row++) {
      for (let column = 0; column < 7; column++) {
        const cellIndex = row * 7 + column;
        const dayNumber = cellIndex - firstWeekday + 1;
        const cellX = gridX + column * columnW;
        const cellY = cellTop + row * rowH;
        const valid = dayNumber >= 1 && dayNumber <= daysInMonth;
        const recommended = valid && dayNumber >= bestStart && dayNumber <= bestEnd;
        const strongest = valid && dayNumber === bestDay;

        let fill = '#F8FAFC';
        let stroke = '#E2E8F0';
        let textColor = '#334155';
        if (recommended) {
          fill = '#DCFCE7';
          stroke = '#86EFAC';
          textColor = '#166534';
        }
        if (strongest) {
          fill = scoreColor;
          stroke = scoreColor;
          textColor = '#FFFFFF';
        }

        canvas.rect(cellX + 2, cellY + 2, columnW - 4, rowH - 4, { fill, stroke, lineWidth: 0.55 });
        if (valid) {
          const innerTop = cellY + 2;
          const innerHeight = rowH - 4;
          const dayFontSize = 10.5;
          const bestFontSize = 5.5;
          const hasBestLabel = strongest;
          const dayTop = hasBestLabel ? innerTop + 5 : innerTop + ((innerHeight - dayFontSize) / 2) - 1;
          canvas.text(String(dayNumber), cellX + columnW / 2, dayTop, dayFontSize, { bold: strongest || recommended, color: textColor, align: 'center' });
          if (strongest) {
            const bestTop = innerTop + innerHeight - bestFontSize - 4;
            canvas.text('BEST', cellX + columnW / 2, bestTop, bestFontSize, { bold: true, color: '#FFFFFF', align: 'center' });
          }
        }
      }
    }

    canvas.rect(x + 16, y + height - 38, width - 32, 24, { fill: '#F0FDF4', stroke: '#BBF7D0', lineWidth: 0.7 });
    canvas.text(`Planting window: ${monthItem.bestRangeFull || monthItem.bestDaysText}`, x + 26, y + height - 31, 9.5, { bold: true, color: '#166534' });
  }

  function getPhaseMonthSegments(startDate, endDate) {
    if (!startDate || !endDate) return [];
    const segments = [];
    let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
    const last = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));

    while (cursor.getTime() <= last.getTime()) {
      const year = cursor.getUTCFullYear();
      const monthIndex = cursor.getUTCMonth();
      const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
      const startDay = year === startDate.getUTCFullYear() && monthIndex === startDate.getUTCMonth()
        ? startDate.getUTCDate()
        : 1;
      const endDay = year === endDate.getUTCFullYear() && monthIndex === endDate.getUTCMonth()
        ? endDate.getUTCDate()
        : daysInMonth;
      segments.push({ year, monthIndex, startDay, endDay });
      cursor = new Date(Date.UTC(year, monthIndex + 1, 1));
    }

    return segments;
  }

  function drawMiniCalendar(canvas, segment, x, y, width, height, accent = '#166534') {
    const year = Number(segment.year);
    const monthIndex = Number(segment.monthIndex);
    const startDay = Number(segment.startDay);
    const endDay = Number(segment.endDay);
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    const headerHeight = 24;
    const gridTop = y + headerHeight + 15;
    const footerHeight = 18;
    const gridHeight = height - headerHeight - footerHeight - 22;
    const rowCount = 6;
    const cellH = gridHeight / rowCount;
    const cellW = width / 7;

    canvas.rect(x, y, width, height, { fill: '#FFFFFF', stroke: '#DDE7DD', lineWidth: 0.7 });
    canvas.text(`${MONTH_NAMES[monthIndex]} ${year}`, x + width / 2, y + 9, 9, { bold: true, color: '#173A24', align: 'center' });

    WEEKDAY_NAMES.forEach((day, index) => {
      canvas.text(day.slice(0, 2), x + index * cellW + cellW / 2, y + 27, 5.5, { bold: true, color: '#64748B', align: 'center' });
    });

    for (let row = 0; row < rowCount; row++) {
      for (let column = 0; column < 7; column++) {
        const cellIndex = row * 7 + column;
        const dayNumber = cellIndex - firstWeekday + 1;
        const cellX = x + column * cellW;
        const cellY = gridTop + row * cellH;
        const valid = dayNumber >= 1 && dayNumber <= daysInMonth;
        const highlighted = valid && dayNumber >= startDay && dayNumber <= endDay;
        const fill = highlighted ? '#DCFCE7' : '#F8FAFC';
        const stroke = highlighted ? accent : '#E2E8F0';
        const textColor = highlighted ? '#166534' : '#334155';
        const inset = 1;
        const innerHeight = cellH - inset * 2;
        const fontSize = 6.2;
        canvas.rect(cellX + inset, cellY + inset, cellW - inset * 2, innerHeight, { fill, stroke, lineWidth: 0.4 });
        if (valid) {
          const dayTop = cellY + inset + ((innerHeight - fontSize) / 2) - 0.5;
          canvas.text(String(dayNumber), cellX + cellW / 2, dayTop, fontSize, { bold: highlighted, color: textColor, align: 'center' });
        }
      }
    }

    canvas.text(`${startDay}-${endDay}`, x + width / 2, y + height - 10, 7, { bold: true, color: accent, align: 'center' });
  }

  function drawPhaseCalendarCard(canvas, phase, x, y, width, height) {
    const accent = phase.color || '#166534';
    const segments = getPhaseMonthSegments(phase.startDate, phase.endDate);
    const dual = segments.length > 1;
    const calendarGap = 8;
    const innerPadding = 14;
    const calendarY = y + 64;
    const calendarHeight = height - 95;
    const calendarWidth = dual
      ? (width - innerPadding * 2 - calendarGap) / 2
      : width - innerPadding * 2;

    canvas.rect(x, y, width, height, { fill: '#FFFFFF', stroke: '#DDE7DD', lineWidth: 0.8 });
    canvas.rect(x, y, 6, height, { fill: accent });
    canvas.text(`${phase.number}. ${phase.title}`, x + 16, y + 12, 10.8, { bold: true, color: '#173A24' });
    canvas.text(phase.dateRange, x + width - 16, y + 12, 8, { bold: true, color: accent, align: 'right' });
    canvas.wrappedText(phase.description, x + 16, y + 29, width - 32, 7.2, { color: '#64748B', maxLines: 2, lineHeight: 8.8 });

    if (!segments.length) {
      canvas.text('No calendar data available.', x + 16, calendarY + 20, 8, { color: '#64748B' });
      return;
    }

    if (dual) {
      drawMiniCalendar(canvas, segments[0], x + innerPadding, calendarY, calendarWidth, calendarHeight, accent);
      drawMiniCalendar(canvas, segments[segments.length - 1], x + innerPadding + calendarWidth + calendarGap, calendarY, calendarWidth, calendarHeight, accent);
    } else {
      drawMiniCalendar(canvas, segments[0], x + innerPadding, calendarY, calendarWidth, calendarHeight, accent);
    }
  }

  function drawPhaseCalendarPage(canvas, phases, pageNumber, totalPages, metadata = {}, monthItem = {}) {
    const location = getPdfLocationDetails(metadata);
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, { fill: '#F4F8F3' });
    canvas.rect(0, 0, PAGE_WIDTH, 72, { fill: '#14532D' });
    canvas.rect(0, 68, PAGE_WIDTH, 4, { fill: '#84CC16' });
    canvas.text('PAL-AI', 25, 13, 20, { bold: true, color: '#FFFFFF' });
    canvas.text('PHASE CALENDAR REFERENCE', 25, 36, 9.3, { bold: true, color: '#D9F99D' });
    canvas.text(`${monthItem.monthName || MONTH_NAMES[monthItem.monthIndex]} ${monthItem.year}`, PAGE_WIDTH - 25, 10, 17, { bold: true, color: '#FFFFFF', align: 'right' });
    canvas.text(location.regionName, PAGE_WIDTH - 25, 32, 8.7, { bold: true, color: '#DCFCE7', align: 'right' });
    canvas.wrappedText(location.detailedLocation, PAGE_WIDTH - 25, 46, 365, 7.1, { color: '#DCFCE7', align: 'right', maxLines: 2, lineHeight: 8.2 });

    canvas.text('Each crop phase has its own highlighted calendar so you can track the expected schedule beyond planting.', 24, 84, 8.8, { color: '#475569' });
    canvas.text(`Page ${pageNumber} of ${totalPages}`, PAGE_WIDTH - 24, 84, 8.3, { color: '#64748B', align: 'right' });

    const left = 24;
    const top = 101;
    const gapX = 16;
    const gapY = 16;
    const columns = 2;
    const rows = 2;
    const cardWidth = (PAGE_WIDTH - left * 2 - gapX) / columns;
    const cardHeight = 220;

    phases.forEach((phase, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const x = left + column * (cardWidth + gapX);
      const y = top + row * (cardHeight + gapY);
      drawPhaseCalendarCard(canvas, phase, x, y, cardWidth, cardHeight);
    });

    canvas.text('Model-based phase timing guide. Validate with in-field observations, water availability, and local agricultural advisories.', 24, 574, 7.2, { color: '#64748B' });
  }

  function drawTimeline(canvas, phases, x, y, width, height) {
    canvas.rect(x, y, width, height, { fill: '#FFFFFF', stroke: '#DDE7DD', lineWidth: 0.9 });
    canvas.text('Crop Growth Timeline', x + 18, y + 15, 17, { bold: true, color: '#173A24' });
    canvas.text('Projected phase periods based on the chosen planting window and crop maturity.', x + 18, y + 38, 8.5, { color: '#64748B' });

    const lineX = x + 28;
    const startTop = y + 70;
    const rowHeight = 35;
    canvas.line(lineX, startTop, lineX, startTop + rowHeight * (phases.length - 1), '#BBF7D0', 3);

    phases.forEach((phase, index) => {
      const rowTop = startTop + index * rowHeight;
      canvas.circle(lineX, rowTop + 3, 7, phase.color || '#166534', '#FFFFFF');
      canvas.text(String(index + 1), lineX, rowTop - 1.5, 6.5, { bold: true, color: '#FFFFFF', align: 'center' });
      canvas.text(phase.title, x + 46, rowTop - 7, 10.5, { bold: true, color: '#173A24' });
      canvas.text(phase.dateRange, x + width - 18, rowTop - 7, 8.2, { bold: true, color: phase.color || '#166534', align: 'right' });
      canvas.wrappedText(phase.description, x + 46, rowTop + 7, width - 67, 7.2, { color: '#64748B', maxLines: 2, lineHeight: 8.5 });
    });
  }

  function createPlantingCalendarPdfBytes(monthItem, metadata = {}) {
    if (!monthItem) throw new Error('No selected monthly planting result was provided.');

    const maturityDays = Number(monthItem.maturityDays || metadata.maturityDays || 115);
    const cropType = monthItem.cropType || metadata.cropType || 'inbred';
    const phases = Array.isArray(monthItem.growthPhases) && monthItem.growthPhases.length
      ? monthItem.growthPhases.map(phase => ({
          ...phase,
          startDate: phase.startDate || parseIsoUtc(phase.startISO),
          endDate: phase.endDate || parseIsoUtc(phase.endISO)
        }))
      : buildPhaseSchedule({ ...monthItem, maturityDays, cropType });

    const startDate = parseIsoUtc(monthItem.bestStartISO);
    const endDate = parseIsoUtc(monthItem.bestEndISO);
    const harvestStart = parseIsoUtc(monthItem.harvestStartISO || monthItem.harvestDateISO) || addUtcDays(startDate, maturityDays);
    const harvestEnd = parseIsoUtc(monthItem.harvestEndISO) || addUtcDays(endDate, maturityDays);
    const plantingRange = monthItem.bestRangeFull || formatRange(startDate, endDate, true);
    const harvestRange = monthItem.harvestRangeFull || formatRange(harvestStart, harvestEnd, true);
    const location = getPdfLocationDetails(metadata);
    const cropLabel = metadata.cropTypeLabel || CROP_LABELS[cropType] || sanitizePdfText(cropType);
    const riskColor = getRiskColor(monthItem.score);

    const canvas = new PdfCanvas(PAGE_WIDTH, PAGE_HEIGHT);
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, { fill: '#F4F8F3' });
    canvas.rect(0, 0, PAGE_WIDTH, 78, { fill: '#14532D' });
    canvas.rect(0, 74, PAGE_WIDTH, 4, { fill: '#84CC16' });
    canvas.text('PAL-AI', 25, 14, 22, { bold: true, color: '#FFFFFF' });
    canvas.text('LONG-TERM PLANTING CALENDAR', 25, 40, 9.5, { bold: true, color: '#D9F99D' });
    canvas.text(`${monthItem.monthName || MONTH_NAMES[monthItem.monthIndex]} ${monthItem.year}`, PAGE_WIDTH - 25, 9, 19, { bold: true, color: '#FFFFFF', align: 'right' });
    canvas.text(location.regionName, PAGE_WIDTH - 25, 34, 8.8, { bold: true, color: '#DCFCE7', align: 'right' });
    canvas.wrappedText(location.detailedLocation, PAGE_WIDTH - 25, 48, 390, 7.2, { color: '#DCFCE7', align: 'right', maxLines: 2, lineHeight: 8.3 });

    const margin = 24;
    const summaryTop = 90;
    const gap = 10;
    const cardWidth = (PAGE_WIDTH - margin * 2 - gap * 3) / 4;
    drawSummaryCard(canvas, margin, summaryTop, cardWidth, 'Planting Window', plantingRange, '#166534');
    drawSummaryCard(canvas, margin + (cardWidth + gap), summaryTop, cardWidth, 'Harvest Period', harvestRange, '#92400E');
    drawSummaryCard(canvas, margin + (cardWidth + gap) * 2, summaryTop, cardWidth, 'Suitability', `${Number(monthItem.score || 0).toFixed(1)}% - ${monthItem.risk || 'Estimated'}`, riskColor);
    drawSummaryCard(canvas, margin + (cardWidth + gap) * 3, summaryTop, cardWidth, 'Rice Profile', `${cropLabel} (${maturityDays} days)`, '#4D7C0F');

    drawMonthCalendar(canvas, monthItem, 24, 157, 337, 341);
    drawTimeline(canvas, phases, 375, 157, PAGE_WIDTH - 399, 341);

    canvas.rect(24, 511, PAGE_WIDTH - 48, 42, { fill: '#ECFDF5', stroke: '#A7F3D0', lineWidth: 0.8 });
    canvas.text(`Projected harvest period: ${harvestRange}`, 36, 521, 11, { bold: true, color: '#166534' });
    canvas.wrappedText(`Planning note: ${monthItem.explanation || 'The selected window balances projected climate, crop-stage risks, water access, pest pressure, and yield potential.'}`, 36, 538, PAGE_WIDTH - 72, 7.8, { color: '#475569', maxLines: 2, lineHeight: 9 });

    const generated = metadata.generatedAt || new Date();
    const generatedLabel = generated instanceof Date
      ? generated.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
      : String(generated);
    canvas.text('Model-based long-range planning guide. Verify with local weather advisories, field conditions, and an agricultural professional.', 24, 568, 7.2, { color: '#64748B' });
    canvas.text(`Generated ${generatedLabel}`, PAGE_WIDTH - 24, 568, 7.2, { color: '#64748B', align: 'right' });

    const pageStreams = [canvas.commands.join('\n')];

    const extraPhaseGroups = [];
    if (phases.length > 4) {
      extraPhaseGroups.push(phases.slice(0, 4));
      if (phases.slice(4).length) extraPhaseGroups.push(phases.slice(4));
    } else if (phases.length) {
      extraPhaseGroups.push(phases);
    }

    const totalPages = 1 + extraPhaseGroups.length;
    extraPhaseGroups.forEach((group, index) => {
      const phaseCanvas = new PdfCanvas(PAGE_WIDTH, PAGE_HEIGHT);
      drawPhaseCalendarPage(phaseCanvas, group, index + 2, totalPages, metadata, monthItem);
      pageStreams.push(phaseCanvas.commands.join('\n'));
    });

    return buildPdfBytes(pageStreams);
  }

  function createFileName(monthItem, metadata = {}) {
    const location = metadata.regionName || metadata.locationLabel || 'Selected_Region';
    const safeLocation = sanitizePdfText(location).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
    const month = monthItem.monthName || MONTH_NAMES[Number(monthItem.monthIndex)] || 'Month';
    return `PALAI_Planting_Calendar_${safeLocation || 'Region'}_${month}_${monthItem.year}.pdf`;
  }

  function downloadPlantingCalendarPdf(monthItem, metadata = {}) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
      throw new Error('PDF download requires a web browser.');
    }
    const bytes = createPlantingCalendarPdfBytes(monthItem, metadata);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = createFileName(monthItem, metadata);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return anchor.download;
  }

  root.PALAIPlantingPdf = {
    CROP_LABELS,
    buildPhaseSchedule,
    createPlantingCalendarPdfBytes,
    downloadPlantingCalendarPdf,
    formatRange,
    parseIsoUtc,
    createFileName
  };
})(typeof window !== 'undefined' ? window : globalThis);

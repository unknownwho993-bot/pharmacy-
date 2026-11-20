import { jsPDF } from 'jspdf';
import type { BillRecord, PharmacySettings } from '../types';

function money(n: number): string {
  return `BDT ${n.toFixed(2)}`;
}

export function exportInvoicePdf(
  bill: BillRecord,
  settings: PharmacySettings,
  paperSize: '58mm' | '80mm' | 'a4'
) {
  if (paperSize === 'a4') {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    let y = 18;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(settings.pharmacyName, 16, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(71, 85, 105);
    doc.text(settings.address, 16, y);
    y += 4.5;
    doc.text(`Phone: ${settings.phone}  |  Drug License: ${settings.drugLicenseNo}`, 16, y);

    // Invoice metadata right side
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('PHARMACY INVOICE', 194, 18, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(`Invoice: ${bill.invoiceNumber}`, 194, 24, { align: 'right' });
    doc.text(
      `Date: ${new Date(bill.createdAt).toLocaleString('en-BD')}`,
      194,
      29,
      { align: 'right' }
    );
    doc.text(`Payment: ${bill.paymentMethod}`, 194, 34, { align: 'right' });

    y = 42;
    doc.setDrawColor(203, 213, 225);
    doc.line(16, y, 194, y);
    y += 7;

    doc.setFontSize(9.5);
    doc.text(`Customer: ${bill.customerName || 'Walk-in Customer'}`, 16, y);
    if (bill.customerPhone) {
      doc.text(`Phone: ${bill.customerPhone}`, 105, y);
    }
    if (bill.doctorName) {
      y += 5;
      doc.text(`Prescribed by: ${bill.doctorName}`, 16, y);
    }
    y += 8;

    // Table header
    doc.setFillColor(241, 245, 249);
    doc.rect(16, y - 4.5, 178, 7.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('#', 18, y);
    doc.text('Medicine', 26, y);
    doc.text('Qty / Packaging', 105, y);
    doc.text('Unit Price', 152, y, { align: 'right' });
    doc.text('Total', 192, y, { align: 'right' });
    y += 6.5;

    doc.setFont('helvetica', 'normal');
    bill.items.forEach((item, idx) => {
      if (y > 260) {
        doc.addPage();
        y = 20;
      }
      doc.text(String(idx + 1), 18, y);
      const medTitle = `${item.medicineName} ${item.strength}`.trim();
      doc.text(medTitle.slice(0, 42), 26, y);
      doc.text(item.packagingNote || `${item.quantity} ${item.unitLabel}`, 105, y);
      doc.text(money(item.unitPrice), 152, y, { align: 'right' });
      doc.text(money(item.lineTotal), 192, y, { align: 'right' });
      y += 6;
      doc.setDrawColor(226, 232, 240);
      doc.line(16, y - 2, 194, y - 2);
    });

    y += 5;
    const summaryX = 138;
    doc.setFontSize(9.5);
    doc.text('Subtotal:', summaryX, y);
    doc.text(money(bill.subtotal), 192, y, { align: 'right' });
    y += 5.5;
    if (bill.discountAmount > 0) {
      doc.text('Discount:', summaryX, y);
      doc.text(`- ${money(bill.discountAmount)}`, 192, y, { align: 'right' });
      y += 5.5;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Grand Total:', summaryX, y);
    doc.text(money(bill.grandTotal), 192, y, { align: 'right' });
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text('Paid:', summaryX, y);
    doc.text(money(bill.paidAmount), 192, y, { align: 'right' });
    y += 5.5;
    if (bill.dueAmount > 0) {
      doc.text('Due:', summaryX, y);
      doc.text(money(bill.dueAmount), 192, y, { align: 'right' });
      y += 5.5;
    }
    if (bill.changeAmount > 0) {
      doc.text('Change:', summaryX, y);
      doc.text(money(bill.changeAmount), 192, y, { align: 'right' });
      y += 5.5;
    }

    y += 10;
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(settings.footerNote, 16, y, { maxWidth: 178 });

    doc.save(`${bill.invoiceNumber}-A4.pdf`);
    return;
  }

  // Thermal 58mm or 80mm receipt PDF
  const widthMm = paperSize === '58mm' ? 58 : 80;
  const estHeight = Math.max(115, 72 + bill.items.length * 11);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [widthMm, estHeight],
  });

  const pad = 3.5;
  const center = widthMm / 2;
  let y = 7;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(paperSize === '58mm' ? 9.5 : 11);
  doc.text(settings.pharmacyName, center, y, { align: 'center' });
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(paperSize === '58mm' ? 6.8 : 7.8);
  const addrLines = doc.splitTextToSize(settings.address, widthMm - pad * 2);
  doc.text(addrLines, center, y, { align: 'center' });
  y += addrLines.length * 3.2;
  doc.text(`Tel: ${settings.phone}`, center, y, { align: 'center' });
  y += 3.2;
  doc.text(`DL: ${settings.drugLicenseNo}`, center, y, { align: 'center' });
  y += 3.5;

  doc.setLineDashPattern([1, 1], 0);
  doc.line(pad, y, widthMm - pad, y);
  y += 3.5;

  doc.text(`Inv: ${bill.invoiceNumber}`, pad, y);
  y += 3.2;
  doc.text(`Date: ${new Date(bill.createdAt).toLocaleString('en-BD')}`, pad, y);
  y += 3.2;
  if (bill.customerName) {
    doc.text(`Cust: ${bill.customerName}`, pad, y);
    y += 3.2;
  }
  doc.text(`Pay: ${bill.paymentMethod}`, pad, y);
  y += 3.2;

  doc.line(pad, y, widthMm - pad, y);
  y += 3.5;

  bill.items.forEach((item) => {
    doc.setFont('helvetica', 'bold');
    const title = `${item.medicineName} ${item.strength}`.trim();
    doc.text(title.slice(0, paperSize === '58mm' ? 28 : 38), pad, y);
    y += 3.2;
    doc.setFont('helvetica', 'normal');
    doc.text(`${item.quantity} x ${item.unitPrice.toFixed(2)}`, pad, y);
    doc.text(item.lineTotal.toFixed(2), widthMm - pad, y, { align: 'right' });
    y += 4.2;
  });

  doc.line(pad, y, widthMm - pad, y);
  y += 3.8;

  const row = (label: string, val: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, pad, y);
    doc.text(val, widthMm - pad, y, { align: 'right' });
    y += 3.6;
  };

  row('Subtotal', bill.subtotal.toFixed(2));
  if (bill.discountAmount > 0) {
    row('Discount', `-${bill.discountAmount.toFixed(2)}`);
  }
  row('GRAND TOTAL', `BDT ${bill.grandTotal.toFixed(2)}`, true);
  row('Paid', bill.paidAmount.toFixed(2));
  if (bill.dueAmount > 0) row('Due', bill.dueAmount.toFixed(2));
  if (bill.changeAmount > 0) row('Change', bill.changeAmount.toFixed(2));

  y += 2;
  doc.setFontSize(6.5);
  const foot = doc.splitTextToSize(settings.footerNote, widthMm - pad * 2);
  doc.text(foot, center, y, { align: 'center' });

  doc.save(`${bill.invoiceNumber}-${paperSize}.pdf`);
}

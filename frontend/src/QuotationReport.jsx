import { useEffect, useState } from "react";
import "./QuotationReport.css";

function formatDate(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN");
}

function createMoneyFormatter() {
  return (amount) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(amount);
}

function formatPdfMoney(amount) {
  const formattedAmount = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(amount);
  return `INR ${formattedAmount}`;
}

async function createQuotationPdf({
  quote,
  isCompletionReport,
  includePaintingOptions,
  area,
  productName,
  coats,
  coverage,
  costPerSquareFoot,
  measurementDetails,
  paintQuantity,
  paintCost,
  labourCost,
  puttyCost,
  primerCost,
  additionalExpenses,
  discount,
  total,
}) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  pdf.setFillColor(36, 76, 58);
  pdf.rect(0, 0, pageWidth, 40, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("PAINTWISE", margin, 15);
  pdf.setFontSize(22);
  pdf.text(
    isCompletionReport ? "PAINTING COMPLETION REPORT" : "PAINTING QUOTATION",
    margin,
    29
  );
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(`Date: ${formatDate(quote.quotationDate)}`, pageWidth - margin, 15, {
    align: "right",
  });
  y = 52;

  const addSectionTitle = (title) => {
    if (y > 260) {
      pdf.addPage();
      y = 20;
    }
    pdf.setTextColor(36, 76, 58);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(title, margin, y);
    y += 7;
    pdf.setDrawColor(220, 228, 218);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 7;
  };

  const addDetail = (label, value, x, startY, width) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(105, 117, 107);
    pdf.text(label.toUpperCase(), x, startY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(38, 59, 46);
    const lines = pdf.splitTextToSize(value || "-", width);
    pdf.text(lines, x, startY + 6);
    return startY + 6 + lines.length * 5;
  };

  addSectionTitle("QUOTATION FOR");
  const leftDetailEnd = addDetail(
    "House owner",
    quote.ownerName,
    margin,
    y,
    contentWidth * 0.46
  );
  const rightDetailEnd = addDetail(
    "Prepared by",
    quote.painterName,
    margin + contentWidth * 0.53,
    y,
    contentWidth * 0.45
  );
  y = Math.max(leftDetailEnd, rightDetailEnd) + 3;
  y = addDetail("Property address", quote.ownerAddress, margin, y, contentWidth) + 3;
  const contactText = [
    quote.painterPhone && `Painter: ${quote.painterPhone}`,
  ]
    .filter(Boolean)
    .join("   |   ");
  if (contactText) {
    y = addDetail("Painter contact", contactText, margin, y, contentWidth) + 5;
  }

  if (includePaintingOptions) {
    addSectionTitle(isCompletionReport ? "COMPLETED WORK" : "PROJECT SCOPE");
    const scopeText = isCompletionReport
      ? `${quote.surfaceType} painting - ${area.toFixed(2)} sq ft - ${formatPdfMoney(costPerSquareFoot)}/sq ft`
      : `${quote.surfaceType} painting - ${area.toFixed(2)} sq ft - ${productName} - ${coats} coat(s) - ${coverage} sq ft/L per coat`;
    y = addDetail("Selected work", scopeText, margin, y, contentWidth) + 5;
  }

  if (isCompletionReport && includePaintingOptions) {
    addSectionTitle("MEASUREMENT BREAKDOWN");
    const addMeasurementLine = (label, detail) => {
      if (y > 265) {
        pdf.addPage();
        y = 20;
      }
      y = addDetail(label, detail, margin, y, contentWidth) + 3;
    };
    measurementDetails.walls.forEach((wall) =>
      addMeasurementLine(
        wall.name,
        `${wall.length} ft x ${wall.height} ft = ${wall.area.toFixed(2)} sq ft`
      )
    );
    addMeasurementLine(
      "Total wall area",
      `${measurementDetails.grossWallArea.toFixed(2)} sq ft`
    );
    measurementDetails.openings.forEach((opening) =>
      addMeasurementLine(
        `${opening.displayName} (${opening.quantity})`,
        `${opening.width} ft x ${opening.height} ft x ${opening.quantity} = ${opening.area.toFixed(2)} sq ft`
      )
    );
    addMeasurementLine(
      "Total doors and windows",
      `${measurementDetails.totalOpeningArea.toFixed(2)} sq ft`
    );
    addMeasurementLine(
      "Net paintable area",
      `${measurementDetails.grossWallArea.toFixed(2)} - ${measurementDetails.totalOpeningArea.toFixed(2)} = ${area.toFixed(2)} sq ft`
    );
  }

  addSectionTitle("COST BREAKDOWN");
  const descriptionX = margin + 2;
  const detailX = margin + contentWidth * 0.68;
  const amountX = pageWidth - margin - 2;
  pdf.setFillColor(239, 244, 237);
  pdf.roundedRect(margin, y - 4, contentWidth, 10, 2, 2, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(60, 77, 64);
  pdf.text("DESCRIPTION", descriptionX, y + 2);
  pdf.text("QUANTITY / RATE", detailX, y + 2);
  pdf.text("AMOUNT (INR)", amountX, y + 2, { align: "right" });
  y += 12;

  const rows = [
    ...(includePaintingOptions
      ? [
          isCompletionReport
            ? {
                description: "Painting cost by measured area",
                detail: `${area.toFixed(2)} sq ft x ${formatPdfMoney(costPerSquareFoot)}/sq ft`,
                amount: paintCost,
              }
            : {
                description: `${quote.surfaceType} paint - ${productName}`,
                detail: `${paintQuantity.toFixed(2)} L x ${formatPdfMoney(paintCost / (paintQuantity || 1))}/L`,
                amount: paintCost,
              },
        ]
      : []),
    ...(!isCompletionReport
      ? [
          {
            description: "Labour charges",
            detail: "As quoted",
            amount: labourCost,
          },
        ]
      : []),
    ...(!isCompletionReport
      ? [
          {
            description: "Wall putty",
            detail: `${area.toFixed(2)} sq ft x ${formatPdfMoney(Number(quote.puttyRatePerSqFoot || 0))}/sq ft`,
            amount: puttyCost,
          },
          {
            description: "Primer",
            detail: `${area.toFixed(2)} sq ft x ${formatPdfMoney(Number(quote.primerRatePerSqFoot || 0))}/sq ft`,
            amount: primerCost,
          },
          {
            description: "Additional expenses",
            detail: "As quoted",
            amount: additionalExpenses,
          },
        ]
      : []),
  ];

  const addCostRow = (description, detail, amount, isDiscount = false) => {
    const descriptionLines = pdf.splitTextToSize(description, contentWidth * 0.4);
    const detailLines = pdf.splitTextToSize(detail, contentWidth * 0.24);
    const rowHeight = Math.max(10, Math.max(descriptionLines.length, detailLines.length) * 5 + 5);
    if (y + rowHeight > 270) {
      pdf.addPage();
      y = 20;
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(38, 59, 46);
    pdf.text(descriptionLines, descriptionX, y + 3);
    pdf.text(detailLines, detailX, y + 3);
    pdf.text(
      `${isDiscount ? "-" : ""}${formatPdfMoney(amount)}`,
      amountX,
      y + 3,
      { align: "right" }
    );
    y += rowHeight;
    pdf.setDrawColor(235, 238, 232);
    pdf.line(margin, y, pageWidth - margin, y);
  };

  rows.forEach((row) =>
    addCostRow(row.description, row.detail, row.amount)
  );
  if (discount > 0) {
    addCostRow("Discount", "Applied", discount, true);
  }

  y += 8;
  if (y > 260) {
    pdf.addPage();
    y = 22;
  }
  pdf.setFillColor(36, 76, 58);
  pdf.roundedRect(margin, y - 5, contentWidth, 20, 3, 3, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text(
    isCompletionReport ? "FINAL AMOUNT" : "TOTAL QUOTATION",
    margin + 5,
    y + 3
  );
  pdf.setFontSize(16);
  pdf.text(formatPdfMoney(total), pageWidth - margin - 5, y + 3, {
    align: "right",
  });
  y += 32;

  if (y > 265) {
    pdf.addPage();
    y = 25;
  }
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(105, 117, 107);
  pdf.text(
    isCompletionReport
      ? "This report records the completed painting work and final charges."
      : "This quotation is an estimate. Final charges may vary with site conditions and agreed scope.",
    margin,
    y
  );
  y += 22;
  pdf.setDrawColor(175, 190, 174);
  pdf.line(margin, y, margin + 58, y);
  pdf.line(pageWidth - margin - 58, y, pageWidth - margin, y);
  pdf.setFontSize(9);
  pdf.text("House owner approval", margin, y + 6);
  pdf.text("Painter signature", pageWidth - margin, y + 6, { align: "right" });

  const safeOwnerName =
    quote.ownerName.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") ||
    "customer";
  pdf.save(
  `painting-${isCompletionReport ? "completion-report" : "quotation"}-${safeOwnerName}.pdf`
  );
}

function QuotationReport({
  quote,
  setQuote,
  areaSource,
  setAreaSource,
  paintableArea,
  setPaintableArea,
  measurementArea,
  selectedPaintProduct,
  setSelectedPaintProduct,
  paintProducts,
  coats,
  setCoats,
  coverage,
  setCoverage,
  paintPrice,
  setPaintPrice,
  walls,
  openings,
  costPerSquareFoot,
  onNavigate,
  money,
  onQuotationSummaryChange,
}) {
  const [pdfError, setPdfError] = useState("");
  const isCompletionReport = quote.reportType === "completion";
  const includePaintingOptions = true;
  const plannedArea =
    areaSource === "measurements" ? measurementArea : Number(paintableArea);
  const measurementDetails = {
    walls: walls.map((wall) => {
      const length = Number(wall.length);
      const height = Number(wall.height);
      return {
        name: wall.name,
        length,
        height,
        area:
          Number.isFinite(length) && length > 0 &&
          Number.isFinite(height) && height > 0
            ? length * height
            : 0,
        isValid:
          Number.isFinite(length) && length > 0 &&
          Number.isFinite(height) && height > 0,
      };
    }),
    openings: openings.map((opening, index) => {
      const width = Number(opening.width);
      const height = Number(opening.height);
      const quantity = Number(opening.quantity);
      const occurrence =
        openings
          .slice(0, index + 1)
          .filter((item) => item.name === opening.name).length;
      const isValid =
        Number.isFinite(width) && width > 0 &&
        Number.isFinite(height) && height > 0 &&
        Number.isInteger(quantity) && quantity > 0;
      return {
        name: opening.name,
        displayName: `${opening.name} ${occurrence}`,
        width,
        height,
        quantity,
        area: isValid ? width * height * quantity : 0,
        isValid,
      };
    }),
  };
  const grossWallArea = measurementDetails.walls.reduce(
    (total, wall) => total + wall.area,
    0
  );
  const totalOpeningArea = measurementDetails.openings.reduce(
    (total, opening) => total + opening.area,
    0
  );
  const measuredNetArea = Math.max(0, grossWallArea - totalOpeningArea);
  const measurementsAreValid =
    measurementDetails.walls.length > 0 &&
    measurementDetails.walls.every((wall) => wall.isValid) &&
    measurementDetails.openings.every((opening) => opening.isValid);
  const area = isCompletionReport ? measuredNetArea : plannedArea;
  const isAreaValid = Number.isFinite(area) && area > 0;
  const numericCostPerSquareFoot = Number(costPerSquareFoot);
  const isPaintingRateValid =
    costPerSquareFoot !== "" &&
    Number.isFinite(numericCostPerSquareFoot) &&
    numericCostPerSquareFoot > 0;
  const isCoverageValid = Number.isFinite(Number(coverage)) && Number(coverage) > 0;
  const estimatedPaintQuantity =
    isAreaValid && isCoverageValid
      ? Math.ceil(((area * coats) / coverage) * 100) / 100
      : 0;
  const paintQuantity = !includePaintingOptions || isCompletionReport
    ? 0
    : estimatedPaintQuantity;
  const effectivePaintPrice = Number(paintPrice || 0);
  const paintCost = includePaintingOptions
    ? isCompletionReport
      ? area * numericCostPerSquareFoot
      : paintQuantity * effectivePaintPrice
    : 0;
  const labourCharge = isCompletionReport
    ? Number(quote.actualLabourCost || 0)
    : Number(quote.labourCharge || 0);
  const puttyRatePerSqFoot = Number(quote.puttyRatePerSqFoot || 0);
  const primerRatePerSqFoot = Number(quote.primerRatePerSqFoot || 0);
  const puttyCost = isCompletionReport
    ? 0
    : area * puttyRatePerSqFoot;
  const primerCost = isCompletionReport
    ? 0
    : area * primerRatePerSqFoot;
  const additionalExpenses = Number(
    isCompletionReport
      ? 0
      : quote.additionalExpenses || 0
  );
  const discount = Number(
    isCompletionReport ? quote.actualDiscount || 0 : quote.discount || 0
  );
  const subtotal =
    paintCost +
    (isCompletionReport ? 0 : labourCharge) +
    (isCompletionReport ? 0 : puttyCost + primerCost + additionalExpenses);
  const total = Math.max(0, subtotal - discount);
  const costValues = [
    includePaintingOptions
      ? isCompletionReport
        ? numericCostPerSquareFoot
        : effectivePaintPrice
      : 0,
    isCompletionReport ? 0 : labourCharge,
    puttyCost,
    primerCost,
    additionalExpenses,
    discount,
  ];
  const costsAreValid = costValues.every(
    (value) => Number.isFinite(value) && value >= 0
  );
  const canGenerate =
    quote.ownerName.trim() !== "" &&
    quote.ownerAddress.trim() !== "" &&
    quote.painterName.trim() !== "" &&
    quote.painterPhone.trim() !== "" &&
    quote.quotationDate !== "" &&
    (!includePaintingOptions ||
      (isCompletionReport
        ? isAreaValid && measurementsAreValid && isPaintingRateValid
        : isAreaValid && isCoverageValid)) &&
    costsAreValid &&
    discount <= subtotal;
  useEffect(() => {
    if (!isCompletionReport && canGenerate) {
      onQuotationSummaryChange?.(total);
    }
  }, [onQuotationSummaryChange, isCompletionReport, canGenerate, total]);
  const productName = paintProducts[selectedPaintProduct] || "Paint";
  const formattedDate = formatDate(quote.quotationDate);
  const measurementMessage = [
    ...measurementDetails.walls.map(
      (wall) =>
        `${wall.name}: ${wall.length} ft x ${wall.height} ft = ${wall.area.toFixed(2)} sq ft`
    ),
    `Total wall area: ${grossWallArea.toFixed(2)} sq ft`,
    ...measurementDetails.openings.map(
      (opening) =>
        `${opening.displayName} (quantity ${opening.quantity}): ${opening.width} ft x ${opening.height} ft x ${opening.quantity} = ${opening.area.toFixed(2)} sq ft`
    ),
    `Total doors and windows: ${totalOpeningArea.toFixed(2)} sq ft`,
    `Net paintable area: ${grossWallArea.toFixed(2)} - ${totalOpeningArea.toFixed(2)} = ${area.toFixed(2)} sq ft`,
    `Area-based painting cost: ${area.toFixed(2)} sq ft x ${money(numericCostPerSquareFoot)}/sq ft = ${money(paintCost)}`,
  ];
  const quoteMessage = [
    `${isCompletionReport ? "Painting completion report" : "Painting quotation"} for ${quote.ownerName}`,
    `Property: ${quote.ownerAddress}`,
    ...(includePaintingOptions
      ? isCompletionReport
        ? [
            `Scope: ${quote.surfaceType} painting`,
            ...measurementMessage,
          ]
        : [
            `Scope: ${quote.surfaceType} painting, ${area.toFixed(2)} sq ft, ${productName}, ${coats} coat(s)`,
            `Estimated paint: ${paintQuantity.toFixed(2)} litres`,
            `Paint: ${money(paintCost)}`,
          ]
      : []),
    ...(!isCompletionReport ? [`Labour: ${money(labourCharge)}`] : []),
    ...(!isCompletionReport
      ? [
          `Putty: ${money(puttyCost)}`,
          `Primer: ${money(primerCost)}`,
          `Additional expenses: ${money(additionalExpenses)}`,
        ]
      : []),
    `${isCompletionReport ? "Actual discount" : "Discount"}: ${money(discount)}`,
    `${isCompletionReport ? "Final amount" : "Quotation total"}: ${createMoneyFormatter()(total)}`,
    isCompletionReport
      ? "Please see the attached completed-work PDF report."
      : "Please see the attached PDF quotation.",
  ].join("\n");
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(quoteMessage)}`;
  const emailUrl = `mailto:?subject=${encodeURIComponent(
    isCompletionReport ? "Painting completion report" : "Painting quotation"
  )}&body=${encodeURIComponent(quoteMessage)}`;

  function updateQuote(field, value) {
    setQuote((currentQuote) => ({ ...currentQuote, [field]: value }));
  }

  function handleProductChange(event) {
    const product = event.target.value;
    setSelectedPaintProduct(product);
    const preset = paintCoveragePresetsForReport[product];
    if (preset) setCoverage(preset);
  }

  async function downloadQuotation() {
    setPdfError("");
    try {
      await createQuotationPdf({
        quote,
        isCompletionReport,
        includePaintingOptions,
        area,
        productName,
        coats,
        coverage,
        costPerSquareFoot: numericCostPerSquareFoot,
        measurementDetails: {
          walls: measurementDetails.walls,
          openings: measurementDetails.openings,
          grossWallArea,
          totalOpeningArea,
        },
        paintQuantity,
        paintCost,
        labourCost: labourCharge,
        puttyCost,
        primerCost,
        additionalExpenses,
        discount,
        total,
      });
    } catch (error) {
      console.error("Unable to generate the painting quotation PDF.", error);
      setPdfError("The PDF could not be generated. Please try again.");
    }
  }

  const rows = [
    ...(includePaintingOptions
      ? [
          isCompletionReport
            ? {
                label: "Painting cost by measured area",
                detail: `${area.toFixed(2)} sq ft x ${money(numericCostPerSquareFoot)}/sq ft`,
                amount: paintCost,
              }
            : {
                label: `${quote.surfaceType} paint - ${productName}`,
                detail: `${paintQuantity.toFixed(2)} L x ${money(effectivePaintPrice)}/L`,
                amount: paintCost,
              },
        ]
      : []),
    ...(!isCompletionReport
      ? [{ label: "Labour charges", detail: "As quoted", amount: labourCharge }]
      : []),
    ...(!isCompletionReport
      ? [
          {
            label: "Wall putty",
            detail: `${area.toFixed(2)} sq ft x ${money(puttyRatePerSqFoot)}/sq ft`,
            amount: puttyCost,
          },
          {
            label: "Primer",
            detail: `${area.toFixed(2)} sq ft x ${money(primerRatePerSqFoot)}/sq ft`,
            amount: primerCost,
          },
          {
            label: "Additional expenses",
            detail: "As quoted",
            amount: additionalExpenses,
          },
        ]
      : []),
  ];

  return (
    <section className="home-tools quotation-report-page" id="quotation-report">
      <div className="home-section-heading">
        <h2>Painting Cost Estimation Report</h2>
        <p>Prepare a professional quotation to download or share with the house owner.</p>
      </div>

      <div className="quotation-report-layout">
        <div className="home-calculator quotation-form">
          <label className="quotation-report-type">
            Report type
            <select
              value={quote.reportType}
              onChange={(e) => updateQuote("reportType", e.target.value)}
            >
              <option value="quotation">Painting quotation (before work)</option>
              <option value="completion">Final report (after work is completed)</option>
            </select>
          </label>
          <h3>{isCompletionReport ? "Completed project details" : "Quotation details"}</h3>
          <div className="quotation-form-grid">
            <label>
              House owner name *
              <input value={quote.ownerName} onChange={(e) => updateQuote("ownerName", e.target.value)} />
            </label>
            <label>
              {isCompletionReport ? "Report date *" : "Quotation date *"}
              <input type="date" value={quote.quotationDate} onChange={(e) => updateQuote("quotationDate", e.target.value)} />
            </label>
            <label className="quotation-full-width">
              House address *
              <textarea rows="2" value={quote.ownerAddress} onChange={(e) => updateQuote("ownerAddress", e.target.value)} />
            </label>
            <label>
              Painter name *
              <input value={quote.painterName} onChange={(e) => updateQuote("painterName", e.target.value)} />
            </label>
            <label>
              Painter phone *
              <input type="tel" value={quote.painterPhone} onChange={(e) => updateQuote("painterPhone", e.target.value)} />
            </label>
          </div>

          <h3>Painting options</h3>
          {includePaintingOptions &&
            (isCompletionReport ? (
              <>
                <div className="quotation-form-grid">
                  <label>
                    Interior or exterior
                    <select
                      value={quote.surfaceType}
                      onChange={(e) =>
                        updateQuote("surfaceType", e.target.value)
                      }
                    >
                      <option>Interior</option>
                      <option>Exterior</option>
                      <option>Interior and exterior</option>
                    </select>
                  </label>
                </div>
                <div className="quotation-measurement-breakdown">
                  <h4>Measured wall area</h4>
                  {measurementDetails.walls.map((wall, index) => (
                    <div className="quotation-measurement-line" key={`wall-${index}`}>
                      <span>{wall.name}</span>
                      <strong>
                        {wall.isValid
                          ? `${wall.length} × ${wall.height} = ${wall.area.toFixed(2)} sq ft`
                          : "Enter valid length and height in Measurements"}
                      </strong>
                    </div>
                  ))}
                  <div className="quotation-measurement-line quotation-measurement-total">
                    <span>Total wall area</span>
                    <strong>{grossWallArea.toFixed(2)} sq ft</strong>
                  </div>
                  <h4>Doors and windows to subtract</h4>
                  {measurementDetails.openings.length === 0 ? (
                    <div className="quotation-measurement-line">
                      <span>No openings entered</span>
                      <strong>0.00 sq ft</strong>
                    </div>
                  ) : (
                    measurementDetails.openings.map((opening, index) => (
                      <div className="quotation-measurement-line" key={`opening-${index}`}>
                        <span>{opening.displayName} × {opening.quantity}</span>
                        <strong>
                          {opening.isValid
                            ? `${opening.width} × ${opening.height} × ${opening.quantity} = ${opening.area.toFixed(2)} sq ft`
                            : "Enter valid dimensions and quantity in Measurements"}
                        </strong>
                      </div>
                    ))
                  )}
                  <div className="quotation-measurement-line quotation-measurement-total">
                    <span>Total doors and windows</span>
                    <strong>{totalOpeningArea.toFixed(2)} sq ft</strong>
                  </div>
                  <div className="quotation-measurement-net">
                    <span>Net paintable area</span>
                    <strong>
                      {grossWallArea.toFixed(2)} − {totalOpeningArea.toFixed(2)} = {area.toFixed(2)} sq ft
                    </strong>
                  </div>
                </div>
                <div className="quotation-measurement-cost">
                  <div>
                    <span>Painting cost per sq ft</span>
                    <strong>
                      {isPaintingRateValid
                        ? money(numericCostPerSquareFoot)
                        : "Rate not set"}
                    </strong>
                  </div>
                  <div>
                    <span>Area-based painting estimate</span>
                    <strong>
                      {area.toFixed(2)} sq ft × {money(numericCostPerSquareFoot)} = {money(paintCost)}
                    </strong>
                  </div>
                </div>
                <div className="quotation-actions quotation-measurement-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => onNavigate("measurements")}
                  >
                    Edit measurements
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => onNavigate("cost-estimation")}
                  >
                    Set cost per sq ft
                  </button>
                </div>
                {!measurementsAreValid && (
                  <p className="quotation-error" role="alert">
                    Complete every wall and door/window measurement, or remove unused opening rows, before generating the final report.
                  </p>
                )}
                {grossWallArea < totalOpeningArea && (
                  <p className="quotation-error" role="alert">
                    Total opening area cannot exceed total wall area.
                  </p>
                )}
                {!isPaintingRateValid && (
                  <p className="quotation-error" role="alert">
                    Enter a painting cost per sq ft in Cost Estimation to calculate the final painting charge.
                  </p>
                )}
              </>
            ) : (
              <div className="quotation-form-grid">
                <label>
                  Painting area
                  <select value={areaSource} onChange={(e) => setAreaSource(e.target.value)}>
                    <option value="measurements">Use Measurements page area</option>
                    <option value="manual">Enter area manually</option>
                  </select>
                </label>
                <label>
                  Area (sq ft) {areaSource === "measurements" ? "from measurements" : ""}
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={areaSource === "measurements" ? measurementArea || "" : paintableArea}
                    onChange={(e) => setPaintableArea(e.target.value)}
                    readOnly={areaSource === "measurements"}
                  />
                </label>
                <label>
                  Interior or exterior
                  <select value={quote.surfaceType} onChange={(e) => updateQuote("surfaceType", e.target.value)}>
                    <option>Interior</option>
                    <option>Exterior</option>
                    <option>Interior and exterior</option>
                  </select>
                </label>
                <label>
                  Paint type or product
                  <select value={selectedPaintProduct} onChange={handleProductChange}>
                    {Object.entries(paintProducts).map(([value, name]) => (
                      <option key={value} value={value}>{name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Number of coats
                  <select value={coats} onChange={(e) => setCoats(Number(e.target.value))}>
                    {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} coat(s)</option>)}
                  </select>
                </label>
                <label>
                  Coverage (sq ft per litre per coat)
                  <input type="number" min="1" value={coverage} onChange={(e) => setCoverage(e.target.value === "" ? 0 : Number(e.target.value))} />
                </label>
                <label>
                  Paint price (₹ per litre)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={paintPrice}
                    onChange={(e) =>
                      setPaintPrice(e.target.value === "" ? 0 : Number(e.target.value))
                    }
                  />
                </label>
              </div>
            ))}

          {!isCompletionReport && (
          <>
          <h3>Quotation costs</h3>
          <div className="quotation-form-grid">
            <label>
              {isCompletionReport ? "Actual labour cost (₹) *" : "Labour charges (₹)"}
              <input
                type="number"
                min="0"
                value={isCompletionReport ? quote.actualLabourCost : quote.labourCharge}
                placeholder="0"
                onChange={(e) =>
                  updateQuote(
                    isCompletionReport ? "actualLabourCost" : "labourCharge",
                    e.target.value
                  )
                }
              />
            </label>
            <label>
              {isCompletionReport
                ? "Actual wall putty cost (₹) *"
                : "Wall putty cost per sq ft (₹)"}
              <input
                type="number"
                min="0"
                step="0.01"
                value={
                  isCompletionReport
                    ? quote.actualPuttyCost
                    : quote.puttyRatePerSqFoot
                }
                onChange={(e) =>
                  updateQuote(
                    isCompletionReport
                      ? "actualPuttyCost"
                      : "puttyRatePerSqFoot",
                    e.target.value
                  )
                }
              />
              {!isCompletionReport && (
                <small>
                  {area.toFixed(2)} sq ft × {money(puttyRatePerSqFoot)} ={" "}
                  {money(puttyCost)}
                </small>
              )}
            </label>
            <label>
              {isCompletionReport
                ? "Actual primer cost (₹) *"
                : "Primer cost per sq ft (₹)"}
              <input
                type="number"
                min="0"
                step="0.01"
                value={
                  isCompletionReport
                    ? quote.actualPrimerCost
                    : quote.primerRatePerSqFoot
                }
                onChange={(e) =>
                  updateQuote(
                    isCompletionReport
                      ? "actualPrimerCost"
                      : "primerRatePerSqFoot",
                    e.target.value
                  )
                }
              />
              {!isCompletionReport && (
                <small>
                  {area.toFixed(2)} sq ft × {money(primerRatePerSqFoot)} ={" "}
                  {money(primerCost)}
                </small>
              )}
            </label>
            <label>
              {isCompletionReport ? "Actual additional expenses (₹) *" : "Additional expenses (₹)"}
              <input
                type="number"
                min="0"
                value={isCompletionReport ? quote.actualAdditionalExpenses : quote.additionalExpenses}
                onChange={(e) =>
                  updateQuote(
                    isCompletionReport ? "actualAdditionalExpenses" : "additionalExpenses",
                    e.target.value
                  )
                }
              />
            </label>
            <label>
              {isCompletionReport ? "Actual discount (₹) *" : "Discount (₹)"}
              <input
                type="number"
                min="0"
                max={subtotal}
                value={isCompletionReport ? quote.actualDiscount : quote.discount}
                onChange={(e) =>
                  updateQuote(
                    isCompletionReport ? "actualDiscount" : "discount",
                    e.target.value
                  )
                }
              />
            </label>
          </div>
          </>
          )}
          {discount > subtotal && (
            <p className="quotation-error">Discount cannot exceed the quotation subtotal.</p>
          )}
          {!canGenerate && (
            <p className="calculator-note">
              {isCompletionReport
                ? "Complete the owner and painter details, measured areas, and cost per sq ft to enable the report actions."
                : "Complete the required owner, painter, area, and cost fields to enable the quotation actions."}
            </p>
          )}
          {isCompletionReport && (
            <p className="calculator-note">
              Any discount is deducted from the measured-area painting amount.
            </p>
          )}
          <div className="quotation-actions">
            <button
              className="home-primary-button"
              type="button"
              disabled={!canGenerate}
              onClick={downloadQuotation}
            >
              {isCompletionReport ? "Download final report PDF" : "Download quotation PDF"}
            </button>
            <a className={`secondary-button${canGenerate ? "" : " is-disabled"}`} href={canGenerate ? whatsappUrl : undefined} target="_blank" rel="noreferrer">WhatsApp</a>
            <a className={`secondary-button${canGenerate ? "" : " is-disabled"}`} href={canGenerate ? emailUrl : undefined}>Email</a>
          </div>
          <p className="calculator-note">Download the PDF and attach it to the WhatsApp or email message. The share links prefill the quotation summary.</p>
          {pdfError && <p className="quotation-error" role="alert">{pdfError}</p>}
        </div>

        <aside className="quotation-preview">
          <div className="quotation-preview-header">
            <span>PAINTWISE</span>
            <small>{isCompletionReport ? "COMPLETION REPORT" : "QUOTATION"} · {formattedDate || "DATE"}</small>
            <h3>{isCompletionReport ? "Completed work report" : "Painting quotation"}</h3>
          </div>
          <div className="quotation-preview-details">
            <div><span>Prepared for</span><strong>{quote.ownerName || "House owner"}</strong><p>{quote.ownerAddress || "House address"}</p></div>
            <div><span>Prepared by</span><strong>{quote.painterName || "Painter name"}</strong><p>{quote.painterPhone || "Painter phone"}</p></div>
          </div>
          {includePaintingOptions && (
            isCompletionReport ? (
              <div className="quotation-preview-measurements">
                <strong>{quote.surfaceType} painting measurements</strong>
                {measurementDetails.walls.map((wall, index) => (
                  <div key={`preview-wall-${index}`}>
                    <span>{wall.name}</span>
                    <span>
                      {wall.isValid
                        ? `${wall.length} × ${wall.height} = ${wall.area.toFixed(2)} sq ft`
                        : "Incomplete dimensions"}
                    </span>
                  </div>
                ))}
                <div className="quotation-preview-measurement-total">
                  <span>Total wall area</span>
                  <span>{grossWallArea.toFixed(2)} sq ft</span>
                </div>
                {measurementDetails.openings.map((opening, index) => (
                  <div key={`preview-opening-${index}`}>
                    <span>{opening.displayName} × {opening.quantity}</span>
                    <span>
                      {opening.isValid
                        ? `${opening.width} × ${opening.height} × ${opening.quantity} = ${opening.area.toFixed(2)} sq ft`
                        : "Incomplete dimensions"}
                    </span>
                  </div>
                ))}
                <div className="quotation-preview-measurement-total">
                  <span>Total doors and windows</span>
                  <span>{totalOpeningArea.toFixed(2)} sq ft</span>
                </div>
                <div className="quotation-preview-measurement-net">
                  <span>Net paintable area</span>
                  <strong>
                    {grossWallArea.toFixed(2)} − {totalOpeningArea.toFixed(2)} = {area.toFixed(2)} sq ft
                  </strong>
                </div>
              </div>
            ) : (
              <div className="quotation-preview-scope">
                <span>{quote.surfaceType} painting</span>
                <span>{isAreaValid ? `${area.toFixed(2)} sq ft` : "Area not entered"}</span>
                <span>{productName} · {coats} coat(s)</span>
                <span>Estimated paint: {paintQuantity.toFixed(2)} L</span>
              </div>
            )
          )}
          <div className="quotation-preview-rows">
            {rows.map((row) => (
              <div className="quotation-preview-row" key={row.label}>
                <span>{row.label}<small>{row.detail}</small></span>
                <strong>{money(row.amount)}</strong>
              </div>
            ))}
            {discount > 0 && (
              <div className="quotation-preview-row">
                <span>Discount</span><strong>−{money(discount)}</strong>
              </div>
            )}
          </div>
          <div className="quotation-preview-total"><span>{isCompletionReport ? "Final amount" : "Quotation total"}</span><strong>{money(total)}</strong></div>
          <p className="quotation-preview-note">
            {isCompletionReport
              ? "This report records the actual completed painting work and final charges."
              : "Estimate only; final cost may vary based on site conditions and agreed scope."}
          </p>
        </aside>
      </div>
    </section>
  );
}

const paintCoveragePresetsForReport = {
  standard: 100,
  economy: 80,
  premium: 120,
  asianPaints: 100,
  berger: 100,
  nerolac: 100,
  dulux: 100,
  indigo: 100,
  nippon: 100,
};

export default QuotationReport;

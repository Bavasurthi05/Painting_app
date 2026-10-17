import { lazy, Suspense, useEffect, useRef, useState } from "react";
import "./Home.css";
import PainterMascot from "./PainterMascot";
import {
  applyExteriorColours,
  detectExteriorSurfaces,
} from "./exteriorColorizer";
import {
  exportProject,
  loadWeeklyAttendance,
  loadProjectData,
  saveWeeklyAttendance,
  saveProjectData,
} from "./measurementApi";
import ProjectDashboard from "./ProjectDashboard";
import PaintingDesign from "./components/PaintingDesign";


const QuotationReport = lazy(() => import("./QuotationReport"));

const paintCoveragePresets = {
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

const paintProductNames = {
  standard: "Standard emulsion",
  economy: "Economy paint",
  premium: "Premium paint",
  asianPaints: "Asian Paints interior emulsion",
  berger: "Berger interior emulsion",
  nerolac: "Nerolac interior emulsion",
  dulux: "Dulux interior emulsion",
  indigo: "Indigo Paints interior emulsion",
  nippon: "Nippon Paint interior emulsion",
  custom: "Custom coverage product",
};

const WALLS_PER_ROOM = 5;

const designSurfaceLabels = {
  walls: "Walls",
  borders: "Borders",
  windows: "Windows",
  doors: "Doors",
  gates: "Gates",
};

const designPaintBrands = {
  asianPaints: {
    name: "Asian Paints",
    shades: [
      { name: "Ivory Mist", color: "#F1E8D7" },
      { name: "Sage Leaf", color: "#9BAF91" },
      { name: "Sky Wash", color: "#9FC5D4" },
      { name: "Rose Clay", color: "#D69A91" },
      { name: "Golden Sand", color: "#D8B779" },
      { name: "Deep Teal", color: "#356B68" },
    ],
  },
  berger: {
    name: "Berger",
    shades: [
      { name: "Pink Possum", color: "#F5E2E9", code: "1P2816" },
      { name: "Teaberry Buds", color: "#F3D4E6", code: "6P0172" },
      { name: "Shibuya Pink", color: "#D06CAD", code: "1D2819" },
      { name: "Beigeful", color: "#FAE2CC", code: "2P0601" },
      { name: "Coral Sea", color: "#FEB799", code: "1T0223" },
      { name: "White Glove", color: "#FCF2DC", code: "3P0057" },
      { name: "Sundry", color: "#FFCD83", code: "2T0685" },
      { name: "Brazen Green", color: "#006259", code: "4A2183" },
      { name: "Botany Blue", color: "#A5E3DF", code: "5P0286" },
      { name: "Lemon Chiffon", color: "#FAF7CE", code: "3P0802" },
      { name: "Secrets Of The Sea", color: "#4B9FB5", code: "5D1046" },
      { name: "Blue Bead", color: "#DBEDEC", code: "5P2223" },
      { name: "Blue Gin", color: "#B2E1E5", code: "5T2224" },
      { name: "Ultra Violet", color: "#6D436E", code: "5A0423" },
      { name: "Lavender Mist", color: "#E1E4EA", code: "6P1233" },
      { name: "Big Falls", color: "#BECADB", code: "6T1203" },
      { name: "Mowed Lawn", color: "#7B723E", code: "7A2411" },
      { name: "Brunette", color: "#977A6E", code: "8D2554" },
      { name: "Spring Banquet", color: "#CEE4E1", code: "7P1449" },
      { name: "Picnic Mat", color: "#C9BAA1", code: "3T0246" },
      { name: "Southern Plantation", color: "#E1E0DC", code: "8P1689" },
      { name: "Versailles", color: "#CCCDC9", code: "8T1691" },
      { name: "Royal Velvet", color: "#554460", code: "5A0424" },
      { name: "Campfire Glow", color: "#DF5B3C", code: "1A0369" },
      { name: "The Heat Is On", color: "#C03630", code: "1A3024" },
      { name: "Savvy White", color: "#F0EFE7", code: "3P1843" },
      { name: "Powder Puff", color: "#EFF0EC", code: "3P1845" },
      { name: "White Swan", color: "#F2EEE5", code: "2P1847" },
    ],
  },
  nerolac: {
    name: "Nerolac",
    shades: [
      { name: "Soft Linen", color: "#EEE9DB" },
      { name: "Mint Garden", color: "#A3C1A5" },
      { name: "Harbour Blue", color: "#8DB5CE" },
      { name: "Coral Tint", color: "#DA9684" },
      { name: "Warm Ochre", color: "#CDA66F" },
      { name: "Smoky Violet", color: "#82758F" },
    ],
  },
  dulux: {
    name: "Dulux",
    shades: [
      { name: "Timeless Cream", color: "#F1E4C8" },
      { name: "Willow Tree", color: "#A6B59A" },
      { name: "Coastal Air", color: "#A5C7D3" },
      { name: "Powder Blush", color: "#D9A7A5" },
      { name: "Spiced Honey", color: "#C99A59" },
      { name: "Night Blue", color: "#50687D" },
    ],
  },
  indigo: {
    name: "Indigo Paints",
    shades: [
      { name: "Pearl Shell", color: "#F2EDE2" },
      { name: "Bamboo Green", color: "#98AD8A" },
      { name: "Rain Cloud", color: "#9BBBCB" },
      { name: "Peach Bloom", color: "#DEA58C" },
      { name: "Desert Dune", color: "#C9AD86" },
      { name: "Pine Shade", color: "#4B7161" },
    ],
  },
  nippon: {
    name: "Nippon Paint",
    shades: [
      { name: "Warm White", color: "#F3EDE1" },
      { name: "Meadow Green", color: "#A2B99A" },
      { name: "Clear Blue", color: "#97BDD2" },
      { name: "Petal Pink", color: "#DDA1AF" },
      { name: "Cocoa Beige", color: "#C7A88A" },
      { name: "Lagoon Teal", color: "#4B8582" },
    ],
  },
};

const designColourPresets = [
  {
    name: "Sage & cream",
    colors: {
      walls: "#C8D5C0",
      borders: "#F4EBDD",
      windows: "#35483D",
      doors: "#79543B",
      gates: "#33463D",
    },
  },
  {
    name: "Coastal blue",
    colors: {
      walls: "#B9D5DF",
      borders: "#F5F0E6",
      windows: "#344D61",
      doors: "#806147",
      gates: "#354858",
    },
  },
  {
    name: "Terracotta",
    colors: {
      walls: "#D58D70",
      borders: "#F1DDC6",
      windows: "#4A5048",
      doors: "#654532",
      gates: "#414942",
    },
  },
];

function getColourFamily(red, green, blue) {
  const maximum = Math.max(red, green, blue) / 255;
  const minimum = Math.min(red, green, blue) / 255;
  const lightness = (maximum + minimum) / 2;
  const saturation =
    maximum === minimum
      ? 0
      : (maximum - minimum) / (1 - Math.abs(2 * lightness - 1));
  if (lightness >= 0.76 && saturation < 0.24) return "white";
  if (saturation < 0.16) return "neutral";

  const redChannel = red / 255;
  const greenChannel = green / 255;
  const blueChannel = blue / 255;
  let hue;
  if (maximum === redChannel) {
    hue = 60 * (((greenChannel - blueChannel) / (maximum - minimum)) % 6);
  } else if (maximum === greenChannel) {
    hue = 60 * ((blueChannel - redChannel) / (maximum - minimum) + 2);
  } else {
    hue = 60 * ((redChannel - greenChannel) / (maximum - minimum) + 4);
  }
  if (hue < 0) hue += 360;

  if (hue >= 15 && hue < 45 && lightness < 0.58) return "brown";
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 45) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 165) return "green";
  if (hue < 195) return "cyan";
  if (hue < 265) return "blue";
  if (hue < 310) return "purple";
  return "pink";
}

function getPhotoDominantColours({ width, height, pixels }) {
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / 20000)));
  const colourFamilies = new Map();

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const family = getColourFamily(red, green, blue);
      const current = colourFamilies.get(family) || {
        count: 0,
        red: 0,
        green: 0,
        blue: 0,
      };
      current.count += 1;
      current.red += red;
      current.green += green;
      current.blue += blue;
      colourFamilies.set(family, current);
    }
  }

  const sampledPixelCount = [...colourFamilies.values()].reduce(
    (total, family) => total + family.count,
    0
  );

  return [...colourFamilies.entries()]
    .filter(([, family]) => family.count / sampledPixelCount >= 0.035)
    .sort((first, second) => second[1].count - first[1].count)
    .slice(0, 8)
    .map(([family, colour]) => ({
      family,
      share: colour.count / sampledPixelCount,
      color: `#${[colour.red, colour.green, colour.blue]
        .map((channel) =>
          Math.round(channel / colour.count)
            .toString(16)
            .padStart(2, "0")
        )
        .join("")}`,
    }));
}

function hexToLab(hex) {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  );
  const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
  const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
  const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;
  const transform = (value) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const [labX, labY, labZ] = [x, y, z].map(transform);

  return [
    116 * labY - 16,
    500 * (labX - labY),
    200 * (labY - labZ),
  ];
}

function getSimilarDesignShades(shades, photoColours) {
  const matchingShades = [];
  const orderedColours = [...photoColours].sort(
    (first, second) => second.share - first.share
  );

  orderedColours.forEach(({ family, color }) => {
    const photoLab = hexToLab(color);
    const familyShades = shades
      .filter((shade) => getColourFamily(
        Number.parseInt(shade.color.slice(1, 3), 16),
        Number.parseInt(shade.color.slice(3, 5), 16),
        Number.parseInt(shade.color.slice(5, 7), 16)
      ) === family)
      .map((shade) => {
        const shadeLab = hexToLab(shade.color);
        const distance = Math.sqrt(
          shadeLab.reduce(
            (total, channel, index) => total + (channel - photoLab[index]) ** 2,
            0
          )
        );
        return { shade, distance };
      })
      .sort((first, second) => first.distance - second.distance);

    familyShades.forEach(({ shade }) => {
      if (!matchingShades.some((matchedShade) => matchedShade.name === shade.name)) {
        matchingShades.push(shade);
      }
    });
  });

  return matchingShades.length ? matchingShades : shades;
}

function createInitialQuoteDetails() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return {
    ownerName: "",
    ownerAddress: "",
    painterName: "",
    painterPhone: "",
    quotationDate: `${today.getFullYear()}-${month}-${day}`,
    reportType: "quotation",
    surfaceType: "Interior",
    puttyRatePerSqFoot: "",
    primerRatePerSqFoot: "",
    additionalExpenses: "",
    discount: "",
    labourCharge: "",
    actualLabourCost: "",
    actualPuttyCost: "",
    actualPrimerCost: "",
    actualAdditionalExpenses: "",
    actualDiscount: "",
  };
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMondayOfWeek(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return formatLocalDate(monday);
}

function Home({
  onLogout,
  onNavigate,
  initialSection = "home",
  walls,
  setWalls,
  openings,
  setOpenings,
  coats,
  setCoats,
  coverage,
  setCoverage,
  paintableArea,
  setPaintableArea,
  areaSource,
  setAreaSource,
  selectedPaintProduct,
  setSelectedPaintProduct,
  measurementStoreStatus,
  onRetryMeasurementSync,
  onFlushMeasurements,
  projectId,
  workspaceId,
  projects,
  activeProject,
  onSelectProject,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  projectActionError,
}) {
const [houseImageRotation, setHouseImageRotation] = useState(
  () => Math.floor(Math.random() * 1000)
);
const previousSectionRef = useRef(initialSection);
const [uploadedImage, setUploadedImage] = useState("");
const [imageName, setImageName] = useState("");
const [imagePixels, setImagePixels] = useState(null);
const [photoDominantColours, setPhotoDominantColours] = useState([]);
const [autoColorMasks, setAutoColorMasks] = useState(null);
const [isColorizing, setIsColorizing] = useState(false);
const [designError, setDesignError] = useState("");
const [designNotice, setDesignNotice] = useState("");
const [designMode, setDesignMode] = useState("unpainted");
const [selectedDesignBrand, setSelectedDesignBrand] = useState("asianPaints");
const [selectedDesignShade, setSelectedDesignShade] = useState(null);
const [surfaceColours, setSurfaceColours] = useState({
  walls: "#C8D5C0",
  borders: "#F4EBDD",
  windows: "#35483D",
  doors: "#79543B",
  gates: "#33463D",
});
const [expenses, setExpenses] = useState([]);
const [payments, setPayments] = useState([]);
const [quotationAmount, setQuotationAmount] = useState(0);
const [projectDataStatus, setProjectDataStatus] = useState("loading");
const [projectDataLoadAttempt, setProjectDataLoadAttempt] = useState(0);
const [projectDataSaveAttempt, setProjectDataSaveAttempt] = useState(0);
const projectDataReadyRef = useRef(false);
const skipProjectExitSaveRef = useRef(false);
const projectDataSaveQueueRef = useRef(Promise.resolve());
const latestProjectDataRef = useRef(null);
const latestAttendanceRef = useRef(null);
const fileInputRef = useRef(null);
const originalCanvasRef = useRef(null);
const paintedCanvasRef = useRef(null);
const imageGenerationRef = useRef(0);
const [attendanceWeekStart, setAttendanceWeekStart] = useState(() =>
  getMondayOfWeek(new Date())
);
const [attendanceLabourers, setAttendanceLabourers] = useState([]);
const [attendanceStoreStatus, setAttendanceStoreStatus] = useState("loading");
const [attendanceLoadedWeek, setAttendanceLoadedWeek] = useState("");
const [attendanceDirty, setAttendanceDirty] = useState(false);
const [attendanceLoadAttempt, setAttendanceLoadAttempt] = useState(0);
const [attendanceSaveAttempt, setAttendanceSaveAttempt] = useState(0);
const attendanceSaveQueueRef = useRef(Promise.resolve());
useEffect(() => {
  skipProjectExitSaveRef.current = false;
}, [projectId]);
useEffect(() => {
  if (initialSection === "home" && previousSectionRef.current !== "home") {
    setHouseImageRotation((rotation) => rotation + 1);
  }
  previousSectionRef.current = initialSection;
}, [initialSection]);

  const [paintPrice, setPaintPrice] = useState(250);
  const [materialCost, setMaterialCost] = useState(500);
  const [costEstimateMode, setCostEstimateMode] = useState("calculator");
  const [manualPaintCost, setManualPaintCost] = useState("");
  const [manualMaterialCost, setManualMaterialCost] = useState("");
  const [houseCostAreaSource, setHouseCostAreaSource] = useState("measurements");
  const [manualHouseArea, setManualHouseArea] = useState("");
  const [costPerSquareFoot, setCostPerSquareFoot] = useState("");
  const [quoteDetails, setQuoteDetails] = useState(() => ({
    ...createInitialQuoteDetails(),
    ownerName: activeProject.customerName,
    ownerAddress: activeProject.location,
  }));
  useEffect(() => {
    latestProjectDataRef.current = {
      paintPrice,
      materialCost,
      costEstimateMode,
      manualPaintCost,
      manualMaterialCost,
      houseCostAreaSource,
      manualHouseArea,
      costPerSquareFoot,
      quoteDetails,
      surfaceColours,
      expenses,
      payments,
      quotationAmount,
    };
  }, [
    paintPrice,
    materialCost,
    costEstimateMode,
    manualPaintCost,
    manualMaterialCost,
    houseCostAreaSource,
    manualHouseArea,
    costPerSquareFoot,
    quoteDetails,
    surfaceColours,
    expenses,
    payments,
    quotationAmount,
  ]);
  useEffect(() => {
    latestAttendanceRef.current = {
      weekStart: attendanceWeekStart,
      loadedWeek: attendanceLoadedWeek,
      labourers: attendanceLabourers,
    };
  }, [attendanceWeekStart, attendanceLoadedWeek, attendanceLabourers]);

  const totalWallArea = walls.reduce((total, wall) => {
    return (
      total +
      Number(wall.length || 0) *
        Number(wall.height || 0) *
        WALLS_PER_ROOM
    );
  }, 0);

  const totalOpeningArea = openings.reduce((total, opening) => {
    return total +
      Number(opening.width || 0) *
      Number(opening.height || 0) *
      Number(opening.quantity || 0);
  }, 0);

  const netArea = Math.max(0, totalWallArea - totalOpeningArea);
  const numericPaintableArea = Number(paintableArea);
  const calculatorArea =
    areaSource === "measurements" ? netArea : numericPaintableArea;
  const isPaintEstimateValid =
    Number.isFinite(calculatorArea) &&
    calculatorArea > 0 &&
    coverage > 0;
  const calculatorLitres = isPaintEstimateValid
    ? (calculatorArea * coats) / coverage
    : 0;
  const roundedCalculatorLitres = Math.ceil(calculatorLitres * 100) / 100;
  const calculatedPaintCost = roundedCalculatorLitres * Number(paintPrice || 0);
  const numericManualHouseArea = Number(manualHouseArea);
  const houseCostArea =
    houseCostAreaSource === "measurements" ? netArea : numericManualHouseArea;
  const numericCostPerSquareFoot = Number(costPerSquareFoot);
  const isHouseAreaEstimateValid =
    Number.isFinite(houseCostArea) &&
    houseCostArea > 0 &&
    costPerSquareFoot !== "" &&
    Number.isFinite(numericCostPerSquareFoot) &&
    numericCostPerSquareFoot > 0;
  const houseAreaPaintCost = isHouseAreaEstimateValid
    ? houseCostArea * numericCostPerSquareFoot
    : 0;
  const manualPaintCostValue = Number(manualPaintCost || 0);
  const manualMaterialCostValue = Number(manualMaterialCost || 0);
  const costInputValues =
    costEstimateMode === "calculator"
      ? [paintPrice, materialCost]
      : costEstimateMode === "area-rate"
        ? [numericCostPerSquareFoot, materialCost]
        : [manualPaintCostValue, manualMaterialCostValue];
  const areCostInputsValid = costInputValues.every(
    (value) => Number.isFinite(value) && value >= 0
  );
  const isPaintCostEstimateValid =
    areCostInputsValid &&
    (costEstimateMode === "calculator"
      ? isPaintEstimateValid
      : costEstimateMode === "area-rate"
        ? isHouseAreaEstimateValid
        : true);
  const selectedPaintCost =
    costEstimateMode === "calculator"
      ? calculatedPaintCost
      : costEstimateMode === "area-rate"
        ? houseAreaPaintCost
        : manualPaintCostValue;
  const selectedMaterialsCost =
    costEstimateMode === "manual"
      ? manualMaterialCostValue
      : Number(materialCost || 0);
  const paintAndMaterialsTotal = selectedPaintCost + selectedMaterialsCost;

  function updatePaintProduct(product) {
    setSelectedPaintProduct(product);
    const presetCoverage = paintCoveragePresets[product];
    if (presetCoverage !== undefined) {
      setCoverage(presetCoverage);
    }
  }

  function addWall() {
    setWalls([
      ...walls,
      {
        id: Date.now(),
        name: `Wall ${walls.length + 1}`,
        length: "",
        height: "",
      },
    ]);
  }

  function updateWall(id, field, value) {
    setWalls(walls.map((wall) =>
      wall.id === id ? { ...wall, [field]: value } : wall
    ));
  }

  function removeWall(id) {
    if (walls.length > 1) {
      setWalls(walls.filter((wall) => wall.id !== id));
    }
  }

  function addOpening() {
    setOpenings([
      ...openings,
      {
        id: Date.now(),
        name: "Window",
        width: "",
        height: "",
        quantity: 1,
      },
    ]);
  }

  function updateOpening(id, field, value) {
    setOpenings(openings.map((opening) =>
      opening.id === id ? { ...opening, [field]: value } : opening
    ));
  }

  function removeOpening(id) {
    setOpenings(openings.filter((opening) => opening.id !== id));
  }
  function goToPage(nextSection) {
  onNavigate(nextSection);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

  const money = (amount) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(amount);

  const attendanceWeekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${attendanceWeekStart}T12:00:00`);
    date.setDate(date.getDate() + index);
    return formatLocalDate(date);
  });
  const attendanceSummary = attendanceLabourers.reduce(
    (summary, labourer) => {
      Object.values(labourer.attendance).forEach((status) => {
        if (status === "present") summary.presentDays += 1;
        if (status === "half-day") summary.halfDays += 1;
        if (status === "absent") summary.absentDays += 1;
      });
      const wage = Number(labourer.dailyWage);
      const advance =
        labourer.advance !== "" &&
        Number.isFinite(Number(labourer.advance)) &&
        Number(labourer.advance) >= 0
          ? Number(labourer.advance)
          : 0;
      summary.totalAdvances += advance;
      if (labourer.dailyWage !== "" && Number.isFinite(wage) && wage >= 0) {
        const paidDays = Object.values(labourer.attendance).reduce(
          (total, status) =>
            total + (status === "present" ? 1 : status === "half-day" ? 0.5 : 0),
          0
        );
        const earnedWages = paidDays * wage;
        summary.estimatedWages += earnedWages;
        summary.balance += earnedWages - advance;
      }
      return summary;
    },
    {
      presentDays: 0,
      halfDays: 0,
      absentDays: 0,
      estimatedWages: 0,
      totalAdvances: 0,
      balance: 0,
    }
  );

  useEffect(() => {
    let isCurrent = true;
    projectDataReadyRef.current = false;
    loadProjectData(workspaceId, projectId)
      .then(({ data }) => {
        if (!isCurrent) return;
        if (data) {
          setPaintPrice(data.paintPrice ?? 250);
          setMaterialCost(data.materialCost ?? 500);
          setCostEstimateMode(
            ["calculator", "area-rate", "manual"].includes(data.costEstimateMode)
              ? data.costEstimateMode
              : "calculator"
          );
          setManualPaintCost(data.manualPaintCost ?? "");
          setManualMaterialCost(data.manualMaterialCost ?? "");
          setHouseCostAreaSource(data.houseCostAreaSource ?? "measurements");
          setManualHouseArea(data.manualHouseArea ?? "");
          setCostPerSquareFoot(data.costPerSquareFoot ?? "");
          if (data.quoteDetails) setQuoteDetails(data.quoteDetails);
          if (data.surfaceColours) setSurfaceColours(data.surfaceColours);
          setExpenses(data.expenses ?? []);
          setPayments(data.payments ?? []);
          setQuotationAmount(data.quotationAmount ?? 0);
        } else {
          setExpenses([]);
          setPayments([]);
          setQuotationAmount(0);
        }
        projectDataReadyRef.current = true;
        setProjectDataStatus("ready");
      })
      .catch((error) => {
        console.error("Could not load this house's project data.", error);
        if (isCurrent) {
          projectDataReadyRef.current = false;
          setProjectDataStatus("error");
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId, projectId, projectDataLoadAttempt]);

  useEffect(() => {
    if (!projectDataReadyRef.current) return undefined;
    const snapshot = {
      paintPrice,
      materialCost,
      costEstimateMode,
      manualPaintCost,
      manualMaterialCost,
      houseCostAreaSource,
      manualHouseArea,
      costPerSquareFoot,
      quoteDetails,
      surfaceColours,
      expenses,
      payments,
      quotationAmount,
    };
    let isCurrent = true;
    const timer = window.setTimeout(() => {
      if (skipProjectExitSaveRef.current) return;
      setProjectDataStatus("saving");
      const queuedSave = projectDataSaveQueueRef.current
        .catch(() => {})
        .then(() => saveProjectData(workspaceId, projectId, snapshot));
      projectDataSaveQueueRef.current = queuedSave;
      queuedSave
        .then(() => {
          if (isCurrent) setProjectDataStatus("saved");
        })
        .catch((error) => {
          console.error("Could not save this house's project data.", error);
          if (isCurrent) setProjectDataStatus("save-error");
        });
    }, 500);
    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
    };
  }, [
    paintPrice,
    materialCost,
    costEstimateMode,
    manualPaintCost,
    manualMaterialCost,
    houseCostAreaSource,
    manualHouseArea,
    costPerSquareFoot,
    quoteDetails,
    surfaceColours,
    expenses,
    payments,
    quotationAmount,
    workspaceId,
    projectId,
    projectDataSaveAttempt,
  ]);

  useEffect(() => {
    const savedWorkspaceId = workspaceId;
    const savedProjectId = projectId;
    return () => {
      const projectSnapshot = latestProjectDataRef.current;
      if (
        !skipProjectExitSaveRef.current &&
        projectDataReadyRef.current &&
        projectSnapshot
      ) {
        const queuedSave = projectDataSaveQueueRef.current
          .catch(() => {})
          .then(() =>
            saveProjectData(
              savedWorkspaceId,
              savedProjectId,
              projectSnapshot
            )
          );
        projectDataSaveQueueRef.current = queuedSave;
        queuedSave.catch((error) => {
          console.error("Could not save house details while leaving the house.", error);
        });
      }

      const attendance = latestAttendanceRef.current;
      if (
        !skipProjectExitSaveRef.current &&
        attendance?.weekStart &&
        attendance.weekStart === attendance.loadedWeek
      ) {
        const queuedSave = attendanceSaveQueueRef.current
          .catch(() => {})
          .then(() =>
            saveWeeklyAttendance(
              savedProjectId,
              attendance.weekStart,
              attendance.labourers
            )
          );
        attendanceSaveQueueRef.current = queuedSave;
        queuedSave.catch((error) => {
          console.error("Could not save attendance while leaving the house.", error);
        });
      }
    };
  }, [workspaceId, projectId]);

  useEffect(() => {
    function saveHouseDataOnPageExit() {
      const projectSnapshot = latestProjectDataRef.current;
      if (
        !skipProjectExitSaveRef.current &&
        projectDataReadyRef.current &&
        projectSnapshot
      ) {
        const queuedSave = projectDataSaveQueueRef.current
          .catch(() => {})
          .then(() =>
            saveProjectData(
              workspaceId,
              projectId,
              projectSnapshot,
              true
            )
          );
        projectDataSaveQueueRef.current = queuedSave;
        queuedSave.catch((error) => {
          console.error("Could not save house details before closing the page.", error);
        });
      }

      const attendance = latestAttendanceRef.current;
      if (
        !skipProjectExitSaveRef.current &&
        attendance?.weekStart &&
        attendance.weekStart === attendance.loadedWeek
      ) {
        const queuedSave = attendanceSaveQueueRef.current
          .catch(() => {})
          .then(() =>
            saveWeeklyAttendance(
              projectId,
              attendance.weekStart,
              attendance.labourers,
              true
            )
          );
        attendanceSaveQueueRef.current = queuedSave;
        queuedSave.catch((error) => {
          console.error("Could not save attendance before closing the page.", error);
        });
      }
    }

    window.addEventListener("pagehide", saveHouseDataOnPageExit);
    return () => window.removeEventListener("pagehide", saveHouseDataOnPageExit);
  }, [workspaceId, projectId]);

  useEffect(() => {
    let isCurrent = true;
    loadWeeklyAttendance(projectId, attendanceWeekStart)
      .then(({ attendance }) => {
        if (!isCurrent) return;
        setAttendanceLabourers(
          (attendance?.labourers || []).map((labourer) => ({
            ...labourer,
            advance: labourer.advance ?? "",
          }))
        );
        setAttendanceLoadedWeek(attendanceWeekStart);
        setAttendanceDirty(false);
        setAttendanceStoreStatus("ready");
      })
      .catch(() => {
        if (isCurrent) setAttendanceStoreStatus("load-error");
      });

    return () => {
      isCurrent = false;
    };
  }, [projectId, attendanceWeekStart, attendanceLoadAttempt]);

  useEffect(() => {
    if (
      !attendanceDirty ||
      attendanceLoadedWeek !== attendanceWeekStart
    ) {
      return undefined;
    }

    let isCurrent = true;
    const snapshot = attendanceLabourers;
    const weekStart = attendanceWeekStart;
    const timer = window.setTimeout(() => {
      if (skipProjectExitSaveRef.current) return;
      setAttendanceStoreStatus("saving");
      const queuedSave = attendanceSaveQueueRef.current
        .catch(() => {})
        .then(() => saveWeeklyAttendance(projectId, weekStart, snapshot));
      attendanceSaveQueueRef.current = queuedSave;
      queuedSave
        .then(() => {
          if (isCurrent) {
            setAttendanceDirty(false);
            setAttendanceStoreStatus("saved");
          }
        })
        .catch(() => {
          if (isCurrent) setAttendanceStoreStatus("save-error");
        });
    }, 400);

    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
    };
  }, [
    attendanceDirty,
    attendanceLoadedWeek,
    attendanceWeekStart,
    attendanceLabourers,
    projectId,
    attendanceSaveAttempt,
  ]);

  function updateAttendanceWeek(date) {
    const nextWeekStart = getMondayOfWeek(new Date(`${date}T12:00:00`));
    if (nextWeekStart === attendanceWeekStart) return;
    setAttendanceStoreStatus("loading");
    setAttendanceLabourers([]);
    setAttendanceDirty(false);
    setAttendanceWeekStart(nextWeekStart);
  }

  function addAttendanceLabourer() {
    setAttendanceLabourers((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: "",
        dailyWage: "",
        advance: "",
        attendance: {},
      },
    ]);
    setAttendanceDirty(true);
  }

  function updateAttendanceLabourer(id, field, value) {
    setAttendanceLabourers((current) =>
      current.map((labourer) =>
        labourer.id === id ? { ...labourer, [field]: value } : labourer
      )
    );
    setAttendanceDirty(true);
  }

  function updateAttendanceStatus(id, day, status) {
    setAttendanceLabourers((current) =>
      current.map((labourer) => {
        if (labourer.id !== id) return labourer;
        const attendance = { ...labourer.attendance };
        if (status) {
          attendance[day] = status;
        } else {
          delete attendance[day];
        }
        return { ...labourer, attendance };
      })
    );
    setAttendanceDirty(true);
  }

  function removeAttendanceLabourer(id) {
    setAttendanceLabourers((current) =>
      current.filter((labourer) => labourer.id !== id)
    );
    setAttendanceDirty(true);
  }

  function downloadAttendanceCsv() {
    const quoteCsv = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = [
      [
        "Labourer",
        "Daily wage",
        ...attendanceWeekDays,
        "Present days",
        "Half-days",
        "Absent days",
        "Estimated wages",
        "Advance",
        "Balance",
      ],
      ...attendanceLabourers.map((labourer) => {
        const statuses = attendanceWeekDays.map(
          (day) => labourer.attendance[day] || "Not marked"
        );
        const presentDays = statuses.filter((status) => status === "present").length;
        const halfDays = statuses.filter((status) => status === "half-day").length;
        const absentDays = statuses.filter((status) => status === "absent").length;
        const wage = Number(labourer.dailyWage);
        const estimatedWages =
          labourer.dailyWage !== "" && Number.isFinite(wage) && wage >= 0
            ? (presentDays + halfDays * 0.5) * wage
            : "";
        const advance =
          labourer.advance !== "" &&
          Number.isFinite(Number(labourer.advance)) &&
          Number(labourer.advance) >= 0
            ? Number(labourer.advance)
            : 0;
        return [
          labourer.name,
          labourer.dailyWage,
          ...statuses,
          presentDays,
          halfDays,
          absentDays,
          estimatedWages,
          labourer.advance,
          estimatedWages === "" ? "" : estimatedWages - advance,
        ];
      }),
    ];
    const csv = rows.map((row) => row.map(quoteCsv).join(",")).join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `labour-attendance-week-${attendanceWeekStart}.csv`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  }

  function renderMeasurementSyncStatus() {
    const hasError = measurementStoreStatus.endsWith("error");
    if (!hasError) return null;

    return (
      <p
        className={`measurement-persistence-status is-${measurementStoreStatus}`}
        role="alert"
      >
        {measurementStoreStatus === "load-error"
          ? "Could not load measurements."
          : "Could not save measurements."}{" "}
        <button
          type="button"
          className="measurement-retry-button"
          onClick={onRetryMeasurementSync}
        >
          Retry
        </button>
      </p>
    );
  }

  function renderProjectDataSyncStatus() {
    const hasError = projectDataStatus.endsWith("error");
    if (!hasError) return null;

    return (
      <p
        className={`measurement-persistence-status is-${projectDataStatus}`}
        role="alert"
      >
        {projectDataStatus === "save-error"
          ? "Could not save this house’s data."
          : "Could not load this house’s data."}{" "}
        <button
          type="button"
          className="measurement-retry-button"
          onClick={retryProjectDataSync}
        >
          Retry
        </button>
      </p>
    );
  }

  function retryProjectDataSync() {
    if (projectDataStatus === "error") {
      setProjectDataStatus("loading");
      setProjectDataLoadAttempt((attempt) => attempt + 1);
    } else {
      setProjectDataSaveAttempt((attempt) => attempt + 1);
    }
  }

  useEffect(() => {
    if (!uploadedImage) {
      return undefined;
    }

    let isCurrentImage = true;
    const image = new Image();
    image.onload = () => {
      if (!isCurrentImage) return;
      const scale = Math.min(1, 1600 / image.width, 1200 / image.height);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        setDesignError("Your browser could not prepare the photo preview.");
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      setImagePixels({
        width,
        height,
        pixels,
      });
      setPhotoDominantColours(getPhotoDominantColours({ width, height, pixels }));
      setDesignError("");
    };
    image.onerror = () => {
      if (isCurrentImage) {
        setDesignError("The selected photo could not be opened.");
      }
    };
    image.src = uploadedImage;

    return () => {
      isCurrentImage = false;
    };
  }, [uploadedImage]);

  useEffect(() => {
    if (!imagePixels) return;
    const { width, height, pixels } = imagePixels;
    const originalContext = originalCanvasRef.current?.getContext("2d");
    const paintedContext = paintedCanvasRef.current?.getContext("2d");
    if (!originalContext || !paintedContext) return;

    originalCanvasRef.current.width = width;
    originalCanvasRef.current.height = height;
    paintedCanvasRef.current.width = width;
    paintedCanvasRef.current.height = height;
    const photo = new ImageData(new Uint8ClampedArray(pixels), width, height);
    originalContext.putImageData(photo, 0, 0);
    paintedContext.putImageData(
      autoColorMasks
        ? applyExteriorColours(imagePixels, autoColorMasks, surfaceColours)
        : photo,
      0,
      0
    );
  }, [imagePixels, autoColorMasks, surfaceColours]);

  function handlePhotoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!acceptedTypes.includes(file.type)) {
      setDesignError("Choose a JPG, PNG, or WEBP photo.");
      event.target.value = "";
      return;
    }
    imageGenerationRef.current += 1;
    setIsColorizing(false);
    setAutoColorMasks(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setDesignError("The selected photo could not be read.");
        return;
      }
      setUploadedImage(reader.result);
      setImageName(file.name);
      setImagePixels(null);
      setPhotoDominantColours([]);
      setAutoColorMasks(null);
      setIsColorizing(false);
      setDesignError("");
      setDesignNotice("");
    };
    reader.onerror = () => {
      setDesignError("The selected photo could not be read.");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function removeDesignPhoto() {
    imageGenerationRef.current += 1;
    setUploadedImage("");
    setImageName("");
    setImagePixels(null);
    setPhotoDominantColours([]);
    setAutoColorMasks(null);
    setIsColorizing(false);
    setDesignError("");
    setDesignNotice("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function applySurfaceColours(colors, label) {
    setSurfaceColours(colors);
    if (!imagePixels || !originalCanvasRef.current) {
      setDesignNotice(`${label} colours selected.`);
      return;
    }
    const generation = imageGenerationRef.current;
    setIsColorizing(true);
    setDesignError("");
    setDesignNotice(
      autoColorMasks
        ? `Applying ${label} colours to detected areas…`
        : "Loading the on-device detection model and identifying house areas…"
    );
    try {
      const masks =
        autoColorMasks || (await detectExteriorSurfaces(originalCanvasRef.current));
      if (generation !== imageGenerationRef.current) return;
      setAutoColorMasks(masks);
      setDesignNotice(
        `${label} colours applied to detected house areas. Review the preview; borders and gates may be approximate.`
      );
    } catch (error) {
      if (generation !== imageGenerationRef.current) return;
      setDesignError(
        error instanceof Error
          ? error.message
          : "Automatic house-area detection failed. Please try another photo."
      );
      setDesignNotice("");
    } finally {
      if (generation === imageGenerationRef.current) {
        setIsColorizing(false);
      }
    }
  }

  async function applyColourPreset(preset) {
    await applySurfaceColours(preset.colors, preset.name);
  }

  function handleSurfaceColourChange(surface, color) {
    setSelectedDesignShade(null);
    void applySurfaceColours(
      { ...surfaceColours, [surface]: color },
      designSurfaceLabels[surface]
    );
  }

  function applyBrandShade(brandKey, shade) {
    setSelectedDesignShade({
      brand: designPaintBrands[brandKey].name,
      ...shade,
    });
    void applySurfaceColours(
      { ...surfaceColours, walls: shade.color },
      `${designPaintBrands[brandKey].name} ${shade.name}`
    );
  }

  function downloadPhotoPreview() {
    const canvas = paintedCanvasRef.current;
    if (!canvas || !imagePixels) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        setDesignError("The colour preview could not be exported.");
        return;
      }
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "painted-house-preview.png";
      link.click();
      URL.revokeObjectURL(downloadUrl);
      setDesignError("");
    }, "image/png");
  }

  function addProjectExpense(record) {
    setExpenses((current) => [...current, record]);
  }

  function removeProjectExpense(recordId) {
    setExpenses((current) => current.filter((record) => record.id !== recordId));
  }

  function addProjectPayment(record) {
    setPayments((current) => [...current, record]);
  }

  function removeProjectPayment(recordId) {
    setPayments((current) => current.filter((record) => record.id !== recordId));
  }

  async function removeHouse(projectToDelete) {
    const deletingActiveHouse = projectToDelete === projectId;
    if (deletingActiveHouse) {
      skipProjectExitSaveRef.current = true;
      await Promise.allSettled([
        projectDataSaveQueueRef.current,
        attendanceSaveQueueRef.current,
      ]);
    }

    try {
      await onDeleteProject(projectToDelete);
    } catch (error) {
      if (deletingActiveHouse) {
        skipProjectExitSaveRef.current = false;
        setProjectDataSaveAttempt((attempt) => attempt + 1);
        setAttendanceSaveAttempt((attempt) => attempt + 1);
      }
      throw error;
    }
  }

  async function exportCurrentHouse() {
    if (!projectDataReadyRef.current) {
      throw new Error("This house’s details are not loaded yet. Retry and try again.");
    }
    if (attendanceLoadedWeek !== attendanceWeekStart) {
      throw new Error("This week’s attendance is still loading. Try the backup again shortly.");
    }
    const projectData = {
      paintPrice,
      materialCost,
      costEstimateMode,
      manualPaintCost,
      manualMaterialCost,
      houseCostAreaSource,
      manualHouseArea,
      costPerSquareFoot,
      quoteDetails,
      surfaceColours,
      expenses,
      payments,
      quotationAmount,
    };
    const queuedProjectSave = projectDataSaveQueueRef.current
      .catch(() => {})
      .then(() => saveProjectData(workspaceId, projectId, projectData));
    projectDataSaveQueueRef.current = queuedProjectSave;
    const queuedAttendanceSave = attendanceSaveQueueRef.current
      .catch(() => {})
      .then(() =>
        saveWeeklyAttendance(projectId, attendanceWeekStart, attendanceLabourers)
      );
    attendanceSaveQueueRef.current = queuedAttendanceSave;
    await Promise.all([
      queuedProjectSave,
      queuedAttendanceSave,
      onFlushMeasurements({
        walls,
        openings,
        coats,
        coverage,
        paintableArea,
        areaSource,
        selectedPaintProduct,
      }),
    ]);
    const backup = await exportProject(workspaceId, projectId);
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeProject.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "house-project"}-backup.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const projectDashboard = (
    <ProjectDashboard
      showHouseControls={initialSection !== "home"}
      showFinancials={initialSection !== "home"}
      showHouseImages={initialSection === "home"}
      houseImageRotation={houseImageRotation}
      workspaceId={workspaceId}
      projects={projects}
      activeProject={activeProject}
      onSelectProject={onSelectProject}
      onDeleteProject={removeHouse}
      onCreateProject={onCreateProject}
      onUpdateProject={onUpdateProject}
      projectActionError={projectActionError}
      quotationAmount={quotationAmount}
      expenses={expenses}
      payments={payments}
      onAddExpense={addProjectExpense}
      onRemoveExpense={removeProjectExpense}
      onAddPayment={addProjectPayment}
      onRemovePayment={removeProjectPayment}
      onExportHouseBackup={exportCurrentHouse}
      money={money}
      projectDataStatus={projectDataStatus}
      onRetryProjectData={retryProjectDataSync}
    />
  );

  return (
    <div className="home-page">
      <header className="home-navbar">
        <a className="home-brand" href="#home">
          <span className="home-brand-icon">⌂</span>
          <span>
            Paint<span className="home-brand-highlight">Wise</span>
            <small>Measure · Estimate · Transform</small>
          </span>
          <PainterMascot />
        </a>

        
<nav className="home-nav-links">
  <a href="#home" onClick={(e) => {
    e.preventDefault();
    onNavigate("home");
  }}>
    Home
  </a>
  <a href="#projects" onClick={(e) => {
    e.preventDefault();
    goToPage("projects");
  }}>
    Houses
  </a>

  <a href="#measurements" onClick={(e) => {
    e.preventDefault();
    onNavigate("measurements");
  }}>
    Measurements
  </a>

  <a href="#paint-calculator" onClick={(e) => {
    e.preventDefault();
    onNavigate("paint-calculator");
  }}>
    Paint Calculator
  </a>

  <a href="#cost-estimation" onClick={(e) => {
    e.preventDefault();
    onNavigate("cost-estimation");
  }}>
    Cost Estimation
  </a>
  
<a
  href="#painting-design"
  onClick={(e) => {
    e.preventDefault();
    goToPage("painting-design");
  }}
>
  Painting Design
</a>

<a
  href="#quotation-report"
  onClick={(e) => {
    e.preventDefault();
    goToPage("quotation-report");
  }}
>
  Quotation Report
</a>

<a
  href="#labour-attendance"
  onClick={(e) => {
    e.preventDefault();
    goToPage("labour-attendance");
  }}
>
  Labour Attendance
</a>

</nav>


        {initialSection !== "home" && (
          <label className="house-nav-switcher">
            <span>Current house</span>
            <select
              aria-label="Switch house project"
              value={activeProject.id}
              onChange={(event) => onSelectProject(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
        )}

        <button className="home-logout" onClick={onLogout}>
          Logout
        </button>
      </header>

      <main id="home">
        {["cost-estimation", "quotation-report", "painting-design"].includes(
          initialSection
        ) && renderProjectDataSyncStatus()}
        
{initialSection === "home" && (
  <>
    <section className="modern-hero" id="home">
      <div className="hero-content">
        <span className="hero-tag">
          <span className="status-dot"></span>
          SMART PAINTING SOLUTIONS
        </span>

        <h1>
          Bring Your Walls
          <br />
          <span>To Life.</span>
        </h1>

        <p>
          Plan your painting project with confidence.
          Measure wall areas, calculate paint quantities,
          estimate costs, and explore beautiful colour
          combinations in one place.
        </p>

        <div className="hero-buttons">
          <button
            className="primary-btn"
            onClick={() => goToPage("measurements")}
          >
            Start Measuring <span>→</span>
          </button>

          <button
            className="secondary-btn"
            onClick={() => goToPage("painting-design")}
          >
            Explore Designs
          </button>
        </div>

        <div className="hero-stats">
          <div>
            <strong>01</strong>
            <span>Measure</span>
          </div>
          <div>
            <strong>02</strong>
            <span>Calculate</span>
          </div>
          <div>
            <strong>03</strong>
            <span>Transform</span>
          </div>
        </div>
      </div>

      <div className="hero-image-wrap">
        <img
          src="https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1100&q=85"
          alt="Beautiful modern living room with elegant wall colours"
          className="hero-image"
        />

        <div className="colour-card">
          <span>INSPIRED COLOURS</span>
          <div className="colour-swatches">
            <i style={{ background: "#A5B59B" }}></i>
            <i style={{ background: "#E7D8C5" }}></i>
            <i style={{ background: "#C2A58A" }}></i>
            <i style={{ background: "#344C3D" }}></i>
            <i style={{ background: "#F5F0E7" }}></i>
          </div>
        </div>
      </div>
    </section>

    <section className="modern-tools">
      <div className="tools-heading">
        <span>YOUR PROJECT WORKSPACE</span>
        <h2>Everything you need to paint smarter.</h2>
        <p>
          From the first measurement to the final colour,
          manage your painting project effortlessly.
        </p>
      </div>

      <div className="modern-tool-grid">
        <button
          className="modern-tool-card"
          onClick={() => goToPage("labour-attendance")}
        >
          <span className="tool-number">WEEKLY / TEAM</span>
          <div className="tool-icon">✓</div>
          <h3>Labour Attendance</h3>
          <p>Track daily attendance and prepare a weekly labour report.</p>
          <span className="tool-link">Open attendance →</span>
        </button>

        <button
          className="modern-tool-card"
          onClick={() => goToPage("measurements")}
        >
          <span className="tool-number">01 / MEASURE</span>
          <div className="tool-icon">↔</div>
          <h3>Wall Measurements</h3>
          <p>Calculate wall area in square feet and account for doors and windows.</p>
          <span className="tool-link">Calculate area →</span>
        </button>

        <button
          className="modern-tool-card"
          onClick={() => goToPage("paint-calculator")}
        >
          <span className="tool-number">02 / MATERIALS</span>
          <div className="tool-icon">◉</div>
          <h3>Paint Calculator</h3>
          <p>Estimate how much paint your project requires based on coverage.</p>
          <span className="tool-link">Estimate paint →</span>
        </button>

        <button
          className="modern-tool-card"
          onClick={() => goToPage("cost-estimation")}
        >
          <span className="tool-number">03 / BUDGET</span>
          <div className="tool-icon">₹</div>
          <h3>Cost Estimation</h3>
          <p>Plan your paint, labour, and material expenses before starting.</p>
          <span className="tool-link">View estimate →</span>
        </button>

        <button
          className="modern-tool-card"
          onClick={() => goToPage("painting-design")}
        >
          <span className="tool-number">04 / DESIGN</span>
          <div className="tool-icon">✳</div>
          <h3>Painting Design</h3>
          <p>Upload a room photo and explore your preferred colour combinations.</p>
          <span className="tool-link">Explore colours →</span>
        </button>

        <button
          className="modern-tool-card"
          onClick={() => goToPage("quotation-report")}
        >
          <span className="tool-number">05 / QUOTATION</span>
          <div className="tool-icon">▤</div>
          <h3>Quotation Report</h3>
          <p>Prepare and download a professional painting quotation for your customer.</p>
          <span className="tool-link">Create quotation →</span>
        </button>
      </div>
    </section>
  </>
)}

        {initialSection === "projects" && projectDashboard}

        {initialSection==="measurements"&&(
        <section className="home-tools" id="measurements">
          <div className="home-section-heading">
            <h2>Home Measurements</h2>
            <p>Enter wall dimensions and subtract doors and windows.</p>
          </div>

          {renderMeasurementSyncStatus()}

          <div className="home-calculator">
            <div className="calculator-heading">
              <h3>Room Measurements</h3>
              <span>
                All dimensions in feet · each room assumes {WALLS_PER_ROOM} walls
                with the entered length and height
              </span>
            </div>

            {walls.map((wall) => (
              <div className="measurement-row" key={wall.id}>
                <label>
                  Room name
                  <input
                    value={wall.name}
                    onChange={(e) =>
                      updateWall(wall.id, "name", e.target.value)
                    }
                    placeholder="Room name"
                  />
                </label>
                <label>
                  Length (ft)
                  <input
                    type="number"
                    min="0"
                    value={wall.length}
                    onChange={(e) =>
                      updateWall(wall.id, "length", e.target.value)
                    }
                    placeholder="e.g. 12"
                  />
                </label>
                <label>
                  Height (ft)
                  <input
                    type="number"
                    min="0"
                    value={wall.height}
                    onChange={(e) =>
                      updateWall(wall.id, "height", e.target.value)
                    }
                    placeholder="e.g. 10"
                  />
                </label>
                <button
                  className="remove-button"
                  onClick={() => removeWall(wall.id)}
                  disabled={walls.length === 1}
                >
                  Remove
                </button>
              </div>
            ))}

            <button className="secondary-button" onClick={addWall}>
              + Add Another Room
            </button>

            <div className="calculator-heading opening-heading">
              <h3>Doors and Windows</h3>
              <span>Areas to exclude</span>
            </div>

            {openings.map((opening) => (
              <div className="measurement-row opening-row" key={opening.id}>
                <label>
                  Type
                  <select
                    value={opening.name}
                    onChange={(e) =>
                      updateOpening(opening.id, "name", e.target.value)
                    }
                  >
                    <option>Door</option>
                    <option>Window</option>
                    <option>Other opening</option>
                  </select>
                </label>
                <label>
                  Width (ft)
                  <input
                    type="number"
                    min="0"
                    value={opening.width}
                    onChange={(e) =>
                      updateOpening(opening.id, "width", e.target.value)
                    }
                    placeholder="e.g. 3"
                  />
                </label>
                <label>
                  Height (ft)
                  <input
                    type="number"
                    min="0"
                    value={opening.height}
                    onChange={(e) =>
                      updateOpening(opening.id, "height", e.target.value)
                    }
                    placeholder="e.g. 7"
                  />
                </label>
                <label>
                  Quantity
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={opening.quantity}
                    onChange={(e) =>
                      updateOpening(opening.id, "quantity", e.target.value)
                    }
                  />
                </label>
                <button
                  className="remove-button"
                  onClick={() => removeOpening(opening.id)}
                >
                  Remove
                </button>
              </div>
            ))}

            <button className="secondary-button" onClick={addOpening}>
              + Add Door or Window
            </button>

            <div className="result-grid">
              <div className="result-card">
                <span>Total Wall Area ({WALLS_PER_ROOM} walls per room)</span>
                <strong>{totalWallArea.toFixed(2)} sq ft</strong>
              </div>
              <div className="result-card">
                <span>Opening Area</span>
                <strong>{totalOpeningArea.toFixed(2)} sq ft</strong>
              </div>
              <div className="result-card result-highlight">
                <span>Net Paintable Area</span>
                <strong>{netArea.toFixed(2)} sq ft</strong>
              </div>
            </div>
          </div>
        </section>
        )}

        {initialSection==="paint-calculator"&&(
        <section className="home-tools" id="paint-calculator">
          <div className="home-section-heading">
            <h2>Paint Quantity Calculator</h2>
            <p>Estimate paint litres using your coverage and coat settings.</p>
          </div>
          {renderMeasurementSyncStatus()}

          <div className="home-calculator paint-calculator">
            <label>
              Calculate area using
              <select
                value={areaSource}
                onChange={(e) => setAreaSource(e.target.value)}
              >
                <option value="measurements">Measurements page</option>
                <option value="manual">Enter area manually</option>
              </select>
            </label>

            {areaSource === "manual" ? (
              <label>
                Paintable area (sq ft)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={paintableArea}
                  onChange={(e) => setPaintableArea(e.target.value)}
                  placeholder="e.g. 500"
                  aria-invalid={
                    paintableArea !== "" &&
                    (!Number.isFinite(numericPaintableArea) ||
                      numericPaintableArea <= 0)
                  }
                />
              </label>
            ) : (
              <div className="result-card calculator-area-summary">
                <span>Net paintable area from measurements</span>
                <strong>{netArea.toFixed(2)} sq ft</strong>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => goToPage("measurements")}
                >
                  Edit measurements
                </button>
              </div>
            )}

            <label>
              Paint brand or product
              <select
                value={selectedPaintProduct}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedPaintProduct(value);
                  const presetCoverage = paintCoveragePresets[value];
                  if (presetCoverage !== undefined) {
                    setCoverage(presetCoverage);
                  }
                }}
              >
                <optgroup label="General examples">
                  <option value="standard">Standard emulsion (sample: 100 sq ft/L)</option>
                  <option value="economy">Economy paint (sample: 80 sq ft/L)</option>
                  <option value="premium">Premium paint (sample: 120 sq ft/L)</option>
                </optgroup>
                <optgroup label="Brands (sample coverage)">
                  <option value="asianPaints">Asian Paints — interior emulsion (100 sq ft/L)</option>
                  <option value="berger">Berger — interior emulsion (100 sq ft/L)</option>
                  <option value="nerolac">Nerolac — interior emulsion (100 sq ft/L)</option>
                  <option value="dulux">Dulux — interior emulsion (100 sq ft/L)</option>
                  <option value="indigo">Indigo Paints — interior emulsion (100 sq ft/L)</option>
                  <option value="nippon">Nippon Paint — interior emulsion (100 sq ft/L)</option>
                </optgroup>
                <option value="custom">Custom coverage</option>
              </select>
            </label>

            <div className="calculator-two-columns">
              <label>
                Coverage (sq ft per litre per coat)
                <input
                  type="number"
                  min="1"
                  value={coverage}
                  onChange={(e) =>
                    setCoverage(
                      e.target.value === "" ? 0 : Number(e.target.value)
                    )
                  }
                />
              </label>

              <label>
                Number of coats
                <select
                  value={coats}
                  onChange={(e) => setCoats(Number(e.target.value))}
                >
                  <option value={1}>1 coat</option>
                  <option value={2}>2 coats</option>
                  <option value={3}>3 coats</option>
                  <option value={4}>4 coats</option>
                </select>
              </label>
            </div>

            <div className="paint-result">
              <span>Estimated Paint Required</span>
              {isPaintEstimateValid ? (
                <>
                  <strong>{roundedCalculatorLitres.toFixed(2)} litres</strong>
                  <p>
                    Based on {calculatorArea.toFixed(2)} sq ft, {coats}{" "}
                    coat(s), and {coverage} sq ft/L per coat.
                  </p>
                </>
              ) : (
                <p>
                  {areaSource === "measurements"
                    ? "Add wall measurements on the Measurements page"
                    : "Enter a paintable area greater than 0"}{" "}
                  and coverage greater than 0 to see your estimate.
                </p>
              )}
            </div>
            <p className="calculator-note">
              Coverage values are examples. Check the selected paint
              product's label for its actual coverage.
            </p>
          </div>
        </section>
        )}
        {initialSection==="cost-estimation"&&(
        <section className="home-tools" id="cost-estimation">
          <div className="home-section-heading">
            <h2>Painting Cost Estimation</h2>
            <p>Estimate your project cost using the paint calculator or enter costs manually.</p>
          </div>

          <div className="home-calculator">
            <label className="cost-mode-select">
              Estimate costs using
              <select
                value={costEstimateMode}
                onChange={(e) => setCostEstimateMode(e.target.value)}
              >
                <option value="calculator">Paint calculator quantity</option>
                <option value="area-rate">House area × cost per sq ft</option>
                <option value="manual">Enter costs manually</option>
              </select>
            </label>

            {costEstimateMode === "calculator" ? (
              <>
                <div className="result-card calculator-area-summary">
                  <span>Selected paint product</span>
                  <strong>
                    {paintProductNames[selectedPaintProduct]} ·{" "}
                    {coverage} sq ft/L · {coats} coat(s)
                  </strong>
                  <span>
                    Paint quantity:{" "}
                    {isPaintEstimateValid
                      ? `${roundedCalculatorLitres.toFixed(2)} litres for ${calculatorArea.toFixed(2)} sq ft`
                      : "Not available yet"}
                  </span>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => goToPage("paint-calculator")}
                  >
                    Edit paint calculation
                  </button>
                </div>

                <div className="calculator-two-columns">
                  <label>
                    Price for selected product (₹ per litre)
                    <input
                      type="number"
                      min="0"
                      value={paintPrice}
                      onChange={(e) =>
                        setPaintPrice(
                          e.target.value === "" ? 0 : Number(e.target.value)
                        )
                      }
                    />
                  </label>
                  <label>
                    Other materials cost (₹)
                    <input
                      type="number"
                      min="0"
                      value={materialCost}
                      onChange={(e) =>
                        setMaterialCost(
                          e.target.value === "" ? 0 : Number(e.target.value)
                        )
                      }
                    />
                  </label>
                </div>
                <p className="calculator-note">
                  Enter the current price from the selected product; prices
                  vary by brand, product, and pack size.
                </p>
              </>
            ) : costEstimateMode === "area-rate" ? (
              <>
                <div className="calculator-two-columns">
                  <label>
                    House area from
                    <select
                      value={houseCostAreaSource}
                      onChange={(e) => setHouseCostAreaSource(e.target.value)}
                    >
                      <option value="measurements">Measurements page</option>
                      <option value="manual">Enter area manually</option>
                    </select>
                  </label>
                  <label>
                    Painting cost per sq ft (₹)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={costPerSquareFoot}
                      onChange={(e) => setCostPerSquareFoot(e.target.value)}
                      placeholder="e.g. 25"
                    />
                  </label>
                </div>
                {houseCostAreaSource === "manual" ? (
                  <label className="manual-house-area">
                    Total house paintable area (sq ft)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={manualHouseArea}
                      onChange={(e) => setManualHouseArea(e.target.value)}
                      placeholder="e.g. 1200"
                    />
                  </label>
                ) : (
                  <div className="result-card calculator-area-summary">
                    <span>Total net area from Measurements page</span>
                    <strong>{netArea.toFixed(2)} sq ft</strong>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => goToPage("measurements")}
                    >
                      Edit measurements
                    </button>
                  </div>
                )}
                <label className="manual-material-cost">
                  Other materials cost (₹)
                  <input
                    type="number"
                    min="0"
                    value={materialCost}
                    onChange={(e) =>
                      setMaterialCost(
                        e.target.value === "" ? 0 : Number(e.target.value)
                      )
                    }
                  />
                </label>
                <p className="calculator-note">
                  Paint cost is calculated as total house area × cost per sq ft.
                  Enter a local rate for your project.
                </p>
              </>
            ) : (
              <div className="calculator-two-columns">
                <label>
                  Paint cost (₹)
                  <input
                    type="number"
                    min="0"
                    value={manualPaintCost}
                    onChange={(e) => setManualPaintCost(e.target.value)}
                    placeholder="e.g. 5000"
                  />
                </label>
                <label>
                  Other materials cost (₹)
                  <input
                    type="number"
                    min="0"
                    value={manualMaterialCost}
                    onChange={(e) => setManualMaterialCost(e.target.value)}
                    placeholder="e.g. 1000"
                  />
                </label>
              </div>
            )}

            {!isPaintCostEstimateValid &&
                costEstimateMode === "calculator" &&
                !isPaintEstimateValid ? (
                  <p className="calculator-note cost-validation-message">
                    Add a valid area and coverage in the Paint Calculator to
                    calculate paint cost.
                  </p>
                ) : !isPaintCostEstimateValid &&
                  costEstimateMode === "area-rate" &&
                  !isHouseAreaEstimateValid ? (
                  <p className="calculator-note cost-validation-message">
                    {houseCostAreaSource === "measurements"
                      ? "Add wall measurements on the Measurements page"
                      : "Enter a house paintable area greater than 0"}
                    {" "}and a cost per sq ft greater than 0 to calculate the
                    paint cost.
                  </p>
                ) : !isPaintCostEstimateValid ? (
                  <p className="calculator-note cost-validation-message">
                    Enter valid paint and materials costs of zero or more to see
                    the estimate.
                  </p>
                ) : (
                  <div className="cost-summary">
                    <div>
                      <span>Paint Cost</span>
                      <strong>{money(selectedPaintCost)}</strong>
                    </div>
                    <div>
                      <span>Materials</span>
                      <strong>{money(selectedMaterialsCost)}</strong>
                    </div>
                    <div className="total-cost">
                      <span>Total Paint &amp; Materials</span>
                      <strong>{money(paintAndMaterialsTotal)}</strong>
                    </div>
                  </div>
                )}

            <p className="calculator-note">
              This is an estimate, not a final quotation. Actual costs
              depend on surface condition, primer, paint type, and local rates.
            </p>
          </div>
        </section>
        )}
        {initialSection === "labour-attendance" && (
          <section className="home-tools" id="labour-attendance">
            <div className="home-section-heading">
              <h2>Weekly Labour Attendance</h2>
              <p>
                Record each labourer’s attendance by day and review the weekly
                totals.
              </p>
            </div>

            <div className="home-calculator attendance-report">
              <div className="attendance-report-heading">
                <label>
                  Week starting (Monday)
                  <input
                    type="date"
                    value={attendanceWeekStart}
                    onChange={(event) => updateAttendanceWeek(event.target.value)}
                  />
                </label>
                <div className="attendance-report-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!attendanceLabourers.length || attendanceLoadedWeek !== attendanceWeekStart}
                    onClick={downloadAttendanceCsv}
                  >
                    Download CSV report
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!attendanceLabourers.length || attendanceLoadedWeek !== attendanceWeekStart}
                    onClick={() => window.print()}
                  >
                    Print / Save PDF
                  </button>
                </div>
              </div>

              {attendanceStoreStatus.endsWith("error") && (
                <p
                  className={`measurement-persistence-status is-${attendanceStoreStatus}`}
                  role="alert"
                >
                  {attendanceStoreStatus === "load-error"
                    ? "Could not load attendance."
                    : "Could not save attendance."}{" "}
                  <button
                    type="button"
                    className="measurement-retry-button"
                    onClick={() => {
                      if (attendanceStoreStatus === "load-error") {
                        setAttendanceStoreStatus("loading");
                        setAttendanceLoadAttempt((attempt) => attempt + 1);
                      } else {
                        setAttendanceStoreStatus("ready");
                        setAttendanceSaveAttempt((attempt) => attempt + 1);
                      }
                    }}
                  >
                    Retry
                  </button>
                </p>
              )}

              <div className="attendance-summary">
                <div className="attendance-summary-card">
                  <span>Present days</span>
                  <strong>{attendanceSummary.presentDays}</strong>
                </div>
                <div className="attendance-summary-card">
                  <span>Half-days</span>
                  <strong>{attendanceSummary.halfDays}</strong>
                </div>
                <div className="attendance-summary-card">
                  <span>Absent days</span>
                  <strong>{attendanceSummary.absentDays}</strong>
                </div>
                <div className="attendance-summary-card attendance-wage-total">
                  <span>Estimated wages*</span>
                  <strong>{money(attendanceSummary.estimatedWages)}</strong>
                </div>
                <div className="attendance-summary-card">
                  <span>Total advances</span>
                  <strong>{money(attendanceSummary.totalAdvances)}</strong>
                </div>
                <div className="attendance-summary-card attendance-wage-total">
                  <span>Calculated balance*</span>
                  <strong>{money(attendanceSummary.balance)}</strong>
                </div>
              </div>

              <div className="attendance-table-scroll">
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th scope="col">Labourer</th>
                      <th scope="col">Daily wage (₹)</th>
                      <th scope="col">Advance (₹)</th>
                      {attendanceWeekDays.map((day) => (
                        <th scope="col" key={day}>
                          <span>
                            {new Date(`${day}T12:00:00`).toLocaleDateString(
                              "en-IN",
                              { weekday: "short" }
                            )}
                          </span>
                          <small>
                            {new Date(`${day}T12:00:00`).toLocaleDateString(
                              "en-IN",
                              { day: "2-digit", month: "short" }
                            )}
                          </small>
                        </th>
                      ))}
                      <th scope="col">Paid days</th>
                      <th scope="col">Wage total</th>
                      <th scope="col">Balance (₹)</th>
                      <th scope="col"><span className="visually-hidden">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceLabourers.length === 0 ? (
                      <tr>
                        <td className="attendance-empty-cell" colSpan={14}>
                          {attendanceLoadedWeek === attendanceWeekStart
                            ? "No labourers yet. Add a labourer to start this weekly report."
                            : "Loading the selected week’s attendance…"}
                        </td>
                      </tr>
                    ) : (
                      attendanceLabourers.map((labourer) => {
                        const paidDays = Object.values(labourer.attendance).reduce(
                          (total, status) =>
                            total +
                            (status === "present"
                              ? 1
                              : status === "half-day"
                                ? 0.5
                                : 0),
                          0
                        );
                        const dailyWage = Number(labourer.dailyWage);
                        const hasDailyWage =
                          labourer.dailyWage !== "" &&
                          Number.isFinite(dailyWage) &&
                          dailyWage >= 0;

                        return (
                          <tr key={labourer.id}>
                            <td>
                              <input
                                aria-label="Labourer name"
                                value={labourer.name}
                                disabled={attendanceLoadedWeek !== attendanceWeekStart}
                                onChange={(event) =>
                                  updateAttendanceLabourer(
                                    labourer.id,
                                    "name",
                                    event.target.value
                                  )
                                }
                                placeholder="Labourer name"
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Daily wage for ${labourer.name || "labourer"}`}
                                type="number"
                                min="0"
                                step="0.01"
                                value={labourer.dailyWage}
                                disabled={attendanceLoadedWeek !== attendanceWeekStart}
                                onChange={(event) =>
                                  updateAttendanceLabourer(
                                    labourer.id,
                                    "dailyWage",
                                    event.target.value
                                  )
                                }
                                placeholder="Optional"
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Advance for ${labourer.name || "labourer"}`}
                                type="number"
                                min="0"
                                step="0.01"
                                value={labourer.advance}
                                disabled={attendanceLoadedWeek !== attendanceWeekStart}
                                onChange={(event) =>
                                  updateAttendanceLabourer(
                                    labourer.id,
                                    "advance",
                                    event.target.value
                                  )
                                }
                                placeholder="0"
                              />
                            </td>
                            {attendanceWeekDays.map((day) => (
                              <td key={day}>
                                <select
                                  aria-label={`${day} attendance for ${labourer.name || "labourer"}`}
                                  value={labourer.attendance[day] || ""}
                                  disabled={attendanceLoadedWeek !== attendanceWeekStart}
                                  onChange={(event) =>
                                    updateAttendanceStatus(
                                      labourer.id,
                                      day,
                                      event.target.value
                                    )
                                  }
                                >
                                  <option value="">—</option>
                                  <option value="present">Present</option>
                                  <option value="half-day">Half-day</option>
                                  <option value="absent">Absent</option>
                                </select>
                              </td>
                            ))}
                            <td className="attendance-number-cell">{paidDays}</td>
                            <td className="attendance-number-cell">
                              {hasDailyWage ? money(paidDays * dailyWage) : "—"}
                            </td>
                            <td className="attendance-number-cell">
                              {hasDailyWage
                                ? money(
                                    paidDays * dailyWage -
                                      (labourer.advance === ""
                                        ? 0
                                        : Number(labourer.advance))
                                  )
                                : "—"}
                            </td>
                            <td>
                              <button
                                className="remove-button attendance-remove-button"
                                type="button"
                                aria-label={`Remove ${labourer.name || "labourer"}`}
                                disabled={attendanceLoadedWeek !== attendanceWeekStart}
                                onClick={() => removeAttendanceLabourer(labourer.id)}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="attendance-footer">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={attendanceLoadedWeek !== attendanceWeekStart}
                  onClick={addAttendanceLabourer}
                >
                  + Add Labourer
                </button>
                <p className="calculator-note">
                  * Wage estimate counts Present as one paid day and Half-day as
                  half pay. Unmarked days are excluded; Absent days are unpaid.
                  Balance is weekly wages minus the manually entered advance;
                  a negative balance means wages are still owed. Calculated
                  balances exclude labourers without a daily wage.
                </p>
              </div>
            </div>
          </section>
        )}
        {initialSection === "quotation-report" && (
          <Suspense fallback={<div className="home-tools">Loading quotation report…</div>}>
            <QuotationReport
              quote={quoteDetails}
              setQuote={setQuoteDetails}
              areaSource={areaSource}
              setAreaSource={setAreaSource}
              paintableArea={paintableArea}
              setPaintableArea={setPaintableArea}
              measurementArea={netArea}
              selectedPaintProduct={selectedPaintProduct}
              setSelectedPaintProduct={updatePaintProduct}
              paintProducts={paintProductNames}
              coats={coats}
              setCoats={setCoats}
              coverage={coverage}
              setCoverage={setCoverage}
              paintPrice={paintPrice}
              setPaintPrice={setPaintPrice}
              walls={walls}
              openings={openings}
              costPerSquareFoot={costPerSquareFoot}
              onNavigate={goToPage}
              money={money}
              onQuotationSummaryChange={setQuotationAmount}
            />
          </Suspense>
        )}
{initialSection === "painting-design" && (
  <PaintingDesign />
)}

        {initialSection==="home"&&(
        projectDashboard
        )}

        {initialSection==="home"&&(
        <section className="home-about" id="about">
          <h2>Painting made simpler.</h2>
          <p>
            PaintWise helps painters measure accurately, reduce paint
            wastage, and plan project costs.
          </p>
        </section>
        )}

        <footer className="home-footer">
          © 2026 PaintWise · Measure smarter. Paint better.
        </footer>
      </main>
    </div>
  );
}

export default Home;
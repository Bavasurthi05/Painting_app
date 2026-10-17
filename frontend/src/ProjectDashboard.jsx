import { useMemo, useState } from "react";
import { loadBusinessSummary } from "./measurementApi";
import "./ProjectDashboard.css";

const PROJECT_STATUSES = ["Not started", "In progress", "On hold", "Completed"];

function todayLocal() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function ProjectDashboard({
  showHouseControls = true,
  showFinancials = true,
  showHouseImages = true,
  houseImageRotation = 0,
  workspaceId,
  projects,
  activeProject,
  onSelectProject,
  onDeleteProject,
  onCreateProject,
  onUpdateProject,
  projectActionError,
  quotationAmount,
  expenses,
  payments,
  onAddExpense,
  onRemoveExpense,
  onAddPayment,
  onRemovePayment,
  onExportHouseBackup,
  money,
  projectDataStatus,
  onRetryProjectData,
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [formMode, setFormMode] = useState("");
  const [form, setForm] = useState(() => ({
    name: activeProject.name,
    customerName: activeProject.customerName,
    location: activeProject.location,
    deadline: activeProject.deadline,
    status: activeProject.status,
  }));
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayLocal);
  const [paymentDescription, setPaymentDescription] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayLocal);
  const [overallOpen, setOverallOpen] = useState(false);
  const [overallStatus, setOverallStatus] = useState("idle");
  const [overallProjects, setOverallProjects] = useState([]);
  const [actionError, setActionError] = useState("");
  const [exporting, setExporting] = useState(false);

  const filteredProjects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus =
        statusFilter === "All statuses" || project.status === statusFilter;
      const matchesSearch =
        !needle ||
        [project.name, project.customerName, project.location, project.deadline]
          .some((value) => value.toLowerCase().includes(needle));
      return matchesStatus && matchesSearch;
    });
  }, [projects, search, statusFilter]);

  const expenseTotal = expenses.reduce((total, item) => total + item.amount, 0);
  const paymentTotal = payments.reduce((total, item) => total + item.amount, 0);
  const visibleOverallProjects = overallProjects
    .filter((project) => projects.some((current) => current.id === project.id))
    .map((project) =>
      project.id === activeProject.id
        ? {
            ...project,
            name: activeProject.name,
            status: activeProject.status,
            quotationAmount,
            expenses: expenseTotal,
            payments: paymentTotal,
            outstanding: quotationAmount - paymentTotal,
          }
        : project
    );

  async function submitProject(event) {
    event.preventDefault();
    setActionError("");
    try {
      if (formMode === "create") await onCreateProject(form);
      else await onUpdateProject(form);
      setFormMode("");
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function toggleOverall() {
    if (overallOpen) {
      setOverallOpen(false);
      return;
    }
    setOverallOpen(true);
    setOverallStatus("loading");
    try {
      const { projects: summary } = await loadBusinessSummary(workspaceId);
      setOverallProjects(summary);
      setOverallStatus("ready");
    } catch (error) {
      setOverallStatus("error");
      setActionError(error.message);
    }
  }

  async function downloadBackup() {
    setExporting(true);
    setActionError("");
    try {
      await onExportHouseBackup();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setExporting(false);
    }
  }

  function addFinanceRecord(kind, event) {
    event.preventDefault();
    const isExpense = kind === "expense";
    const description = isExpense ? expenseDescription.trim() : paymentDescription.trim();
    const amount = Number(isExpense ? expenseAmount : paymentAmount);
    const date = isExpense ? expenseDate : paymentDate;
    if (!description || !date || !Number.isFinite(amount) || amount < 0) return;
    const record = { id: crypto.randomUUID(), date, description, amount };
    if (isExpense) {
      onAddExpense(record);
      setExpenseDescription("");
      setExpenseAmount("");
      setExpenseDate(todayLocal());
    } else {
      onAddPayment(record);
      setPaymentDescription("");
      setPaymentAmount("");
      setPaymentDate(todayLocal());
    }
  }

  function startProjectCreation() {
    setForm({
      name: `House ${projects.length + 1}`,
      customerName: "",
      location: "",
      deadline: "",
      status: "Not started",
    });
    setActionError("");
    setFormMode("create");
  }

  function startProjectEdit() {
    setForm({
      name: activeProject.name,
      customerName: activeProject.customerName,
      location: activeProject.location,
      deadline: activeProject.deadline,
      status: activeProject.status,
    });
    setActionError("");
    setFormMode("edit");
  }

  return (
    <section className="project-dashboard home-tools" id="projects">
      <div className="home-section-heading">
        <span>PAINTER PROJECT MANAGEMENT</span>
        <h2>{showHouseImages ? "House Painting Projects" : "House projects"}</h2>
        <p>Keep every customer’s measurements, reports, attendance, and finances in a separate workspace.</p>
      </div>

      {showHouseControls && (
        <div className="project-dashboard-toolbar">
          <div className="project-toolbar-actions">
            <button className="home-primary-button" type="button" onClick={startProjectCreation}>
              + Add House
            </button>
            <button className="project-secondary-button" type="button" onClick={startProjectEdit}>
              Edit House
            </button>
            <button className="project-secondary-button" type="button" disabled={exporting} onClick={downloadBackup}>
              {exporting ? "Preparing backup…" : "Export House Backup"}
            </button>
          </div>
        </div>
      )}

      {(projectActionError || actionError) && (
        <p className="project-error" role="alert">{actionError || projectActionError}</p>
      )}
      {(projectDataStatus === "error" || projectDataStatus === "save-error") && (
        <p className={`project-sync-status is-${projectDataStatus}`} role="alert">
          {projectDataStatus === "save-error"
            ? "Could not save this house’s details."
            : "Could not load this house’s details."}{" "}
          <button type="button" onClick={onRetryProjectData}>Retry</button>
        </p>
      )}

      {showFinancials && (
        <div className="project-summary-grid">
          <article><span>Quotation</span><strong>{money(quotationAmount)}</strong></article>
          <article><span>Expenses recorded</span><strong>{money(expenseTotal)}</strong></article>
          <article><span>Payments received</span><strong>{money(paymentTotal)}</strong></article>
          <article><span>Outstanding</span><strong>{money(quotationAmount - paymentTotal)}</strong></article>
        </div>
      )}

      {showHouseControls && (
        <div className="project-current-card">
          <div>
            <span className={`project-status-badge status-${activeProject.status.toLowerCase().replaceAll(" ", "-")}`}>
              {activeProject.status}
            </span>
            <h3>{activeProject.name}</h3>
            <p>{activeProject.customerName || "Customer not added"} · {activeProject.location || "Location not added"}</p>
            <p>{activeProject.deadline ? `Deadline: ${activeProject.deadline}` : "No deadline set"}</p>
          </div>
          {showFinancials && (
            <button className="project-secondary-button" type="button" onClick={toggleOverall}>
              {overallOpen ? "Hide overall business summary" : "View overall business summary"}
            </button>
          )}
        </div>
      )}

      {showFinancials && overallOpen && (
        <div className="overall-summary-panel">
          <h3>Overall business summary</h3>
          {overallStatus === "loading" && <p role="status">Loading totals across houses…</p>}
          {overallStatus === "error" && <p role="alert">Could not load the overall summary. Try opening it again.</p>}
          {overallStatus === "ready" && (
            <>
              <div className="project-summary-grid">
                <article><span>Quotation total</span><strong>{money(visibleOverallProjects.reduce((sum, item) => sum + item.quotationAmount, 0))}</strong></article>
                <article><span>Expenses</span><strong>{money(visibleOverallProjects.reduce((sum, item) => sum + item.expenses, 0))}</strong></article>
                <article><span>Payments received</span><strong>{money(visibleOverallProjects.reduce((sum, item) => sum + item.payments, 0))}</strong></article>
                <article><span>Outstanding</span><strong>{money(visibleOverallProjects.reduce((sum, item) => sum + item.outstanding, 0))}</strong></article>
              </div>
              <div className="project-table-scroll">
                <table className="project-table">
                  <thead><tr><th>House</th><th>Status</th><th>Quotation</th><th>Expenses</th><th>Received</th><th>Outstanding</th></tr></thead>
                  <tbody>{visibleOverallProjects.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td><td>{item.status}</td>
                      <td>{money(item.quotationAmount)}</td><td>{money(item.expenses)}</td>
                      <td>{money(item.payments)}</td><td>{money(item.outstanding)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <div className="project-section-heading">
        <div className="project-filters">
          <label>Search houses<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Customer, location, deadline…" /></label>
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{PROJECT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        </div>
      </div>
      <div className="project-list-grid">
        {filteredProjects.map((project) => (
          <article className="project-list-item" key={project.id}>
            <button
              className={`project-list-card${project.id === activeProject.id ? " is-active" : ""}${showHouseImages ? "" : " without-house-photo"}`}
              type="button"
              aria-pressed={project.id === activeProject.id}
              onClick={() => onSelectProject(project.id)}
            >
              {showHouseImages && (
                <HouseIllustration
                  project={project}
                  illustrationIndex={projects.findIndex((item) => item.id === project.id)}
                  rotation={houseImageRotation}
                />
              )}
              <span className={`project-status-badge status-${project.status.toLowerCase().replaceAll(" ", "-")}`}>{project.status}</span>
              <strong>{project.name}</strong>
              <span>{project.customerName || "Customer not added"}</span>
              <span>{project.location || "Location not added"}</span>
              <small>{project.deadline ? `Due ${project.deadline}` : "No deadline"}</small>
            </button>
            {showHouseControls && (
              <>
                <button
                  className="project-remove-button"
                  type="button"
                  disabled={projects.length <= 1}
                  title={
                    projects.length <= 1
                      ? "At least one house must remain in the workspace."
                      : undefined
                  }
                  onClick={async () => {
                    const confirmed = window.confirm(
                      `Permanently remove ${project.name} and all of its measurements, estimates, quotations, attendance, expenses, payments, and project details? This cannot be undone.`
                    );
                    if (!confirmed) return;
                    setActionError("");
                    try {
                      await onDeleteProject(project.id);
                    } catch (error) {
                      setActionError(error.message);
                    }
                  }}
                >
                  Remove house
                </button>
                {projects.length <= 1 && (
                  <small className="project-delete-note">
                    At least one house must remain.
                  </small>
                )}
              </>
            )}
          </article>
        ))}
        {filteredProjects.length === 0 && <p className="project-empty-state">No houses match those filters.</p>}
      </div>

      {showFinancials && (
      <div className="project-finance-columns">
        <section className="project-finance-card">
          <h3>Project expenses</h3>
          <form onSubmit={(event) => addFinanceRecord("expense", event)}>
            <label>Description<input disabled={projectDataStatus === "loading" || projectDataStatus === "error"} required maxLength={200} value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} /></label>
            <label>Date<input disabled={projectDataStatus === "loading" || projectDataStatus === "error"} required type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
            <label>Amount (₹)<input disabled={projectDataStatus === "loading" || projectDataStatus === "error"} required type="number" min="0" step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} /></label>
            <button className="home-primary-button" disabled={projectDataStatus === "loading" || projectDataStatus === "error"} type="submit">Add expense</button>
          </form>
          <FinanceList records={expenses} onRemove={onRemoveExpense} money={money} empty="No expenses added yet." />
        </section>
        <section className="project-finance-card">
          <h3>Payments received</h3>
          <form onSubmit={(event) => addFinanceRecord("payment", event)}>
            <label>Description<input disabled={projectDataStatus === "loading" || projectDataStatus === "error"} required maxLength={200} value={paymentDescription} onChange={(event) => setPaymentDescription(event.target.value)} /></label>
            <label>Date<input disabled={projectDataStatus === "loading" || projectDataStatus === "error"} required type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
            <label>Amount (₹)<input disabled={projectDataStatus === "loading" || projectDataStatus === "error"} required type="number" min="0" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
            <button className="home-primary-button" disabled={projectDataStatus === "loading" || projectDataStatus === "error"} type="submit">Add payment</button>
          </form>
          <FinanceList records={payments} onRemove={onRemovePayment} money={money} empty="No payments recorded yet." />
        </section>
      </div>
      )}

      {formMode && (
        <div className="project-form-backdrop" role="presentation">
          <form className="project-form-card" onSubmit={submitProject}>
            <h3>{formMode === "create" ? "Add a house project" : "Edit house details"}</h3>
            <label>Project name<input required maxLength={120} value={form.name || ""} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Customer name<input maxLength={120} value={form.customerName || ""} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></label>
            <label>Location<input maxLength={240} value={form.location || ""} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
            <label>Deadline<input type="date" value={form.deadline || ""} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label>
            <label>Status<select value={form.status || "Not started"} onChange={(event) => setForm({ ...form, status: event.target.value })}>{PROJECT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
            {(actionError || projectActionError) && <p className="project-error" role="alert">{actionError || projectActionError}</p>}
            <div className="project-form-actions">
              <button className="project-secondary-button" type="button" onClick={() => setFormMode("")}>Cancel</button>
              <button className="home-primary-button" type="submit">{formMode === "create" ? "Create house" : "Save details"}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

const houseIllustrations = [
  { sky: "#d9edf2", wall: "#f1d4a8", roof: "#a94f43", door: "#537b63", trim: "#fff7e9", style: "cottage", ground: "#8cb67d" },
  { sky: "#e4ebd9", wall: "#d9e7cf", roof: "#526d59", door: "#bd7957", trim: "#fffaf0", style: "modern", ground: "#99b783" },
  { sky: "#f5e5d5", wall: "#f0c5ad", roof: "#718ca1", door: "#795e4b", trim: "#fff7e9", style: "coastal", ground: "#83b899" },
  { sky: "#e1e3f0", wall: "#d5d5ea", roof: "#864d5c", door: "#526b79", trim: "#fffaf0", style: "townhouse", ground: "#91a884" },
  { sky: "#dceee5", wall: "#f2e8bc", roof: "#647d9b", door: "#a65d43", trim: "#fffdf2", style: "bungalow", ground: "#8dbb83" },
  { sky: "#f2e5d3", wall: "#d7e6dc", roof: "#765c48", door: "#a95e43", trim: "#fffaf0", style: "courtyard", ground: "#9db67c" },
  { sky: "#e4edf1", wall: "#e6c99d", roof: "#536e7b", door: "#765345", trim: "#fff7e9", style: "farmhouse", ground: "#82aa75" },
  { sky: "#ece4f2", wall: "#f0d7cb", roof: "#765d83", door: "#567564", trim: "#fffaf0", style: "villa", ground: "#a0b77f" },
];

const housePhotoFiles = ["house-01.jpg", "house-02.jpg", "house-03.jpg", "house-04.jpg"];

function HouseIllustration({ project, illustrationIndex, rotation }) {
  const palette = houseIllustrations[illustrationIndex % houseIllustrations.length];
  const photoFile = housePhotoFiles[
    (illustrationIndex + rotation) % housePhotoFiles.length
  ];

  return (
    <svg
      className="project-house-illustration"
      viewBox="0 0 260 160"
      role="img"
      aria-label={`Indian home design photo for ${project.name}`}
    >
      <rect width="260" height="160" rx="12" fill={palette.sky} />
      <circle cx={palette.style === "coastal" ? 47 : 214} cy="29" r="13" fill="#f7c86e" />
      <path d="M0 123 Q46 103 94 119 T182 116 T260 119 V160 H0Z" fill={palette.ground} />
      <path d="M0 139 Q58 126 115 139 T260 135 V160 H0Z" fill="#709c68" opacity=".55" />
      <path d="M28 46 Q37 37 47 45 Q56 36 66 46 H70 Q71 53 64 53 H31 Q23 53 28 46Z" fill="#fffaf2" opacity=".86" />
      <path d="M145 32 Q151 26 158 32 Q165 26 172 33 H175 Q176 39 170 39 H148 Q142 39 145 32Z" fill="#fffaf2" opacity=".72" />

      {palette.style === "cottage" && (
        <>
          <path d="M54 74 L126 28 L200 74 V130 H54Z" fill={palette.wall} stroke="#876e59" strokeWidth="2.5" />
          <path d="M45 77 L126 22 L207 77 L198 82 L126 34 L54 82Z" fill={palette.roof} stroke="#74433e" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M173 52 V28 H188 V63" fill={palette.wall} stroke="#876e59" strokeWidth="2.5" />
          <path d="M171 29 H190 L188 24 H174Z" fill={palette.roof} />
          <path d="M108 52 Q126 37 144 52 V72 H108Z" fill={palette.trim} stroke="#6d8790" strokeWidth="2" />
          <path d="M126 40 V72 M108 58 H144" stroke="#6d8790" strokeWidth="2" />
          <rect x="111" y="88" width="30" height="42" rx="12" fill={palette.door} stroke="#725b4c" strokeWidth="2" />
          <rect x="68" y="82" width="24" height="23" fill={palette.trim} stroke="#6d8790" strokeWidth="2" />
          <path d="M80 82 V105 M68 93 H92" stroke="#6d8790" strokeWidth="2" />
          <rect x="162" y="82" width="24" height="23" fill={palette.trim} stroke="#6d8790" strokeWidth="2" />
          <path d="M174 82 V105 M162 93 H186" stroke="#6d8790" strokeWidth="2" />
          <path d="M61 76 H191" stroke="#d98961" strokeWidth="3" strokeDasharray="3 5" />
        </>
      )}

      {palette.style === "modern" && (
        <>
          <path d="M43 67 H206 V132 H43Z" fill={palette.wall} stroke="#708276" strokeWidth="2.5" />
          <path d="M34 64 H215 V73 H34Z" fill={palette.roof} />
          <path d="M57 48 H135 V66 H57Z" fill="#f8f4e9" stroke="#708276" strokeWidth="2" />
          <path d="M143 48 H192 V66 H143Z" fill={palette.wall} stroke="#708276" strokeWidth="2" />
          <rect x="59" y="82" width="55" height="48" fill="#a8d0d5" stroke="#607c80" strokeWidth="2" />
          <path d="M87 82 V130 M59 105 H114" stroke="#fffaf0" strokeWidth="3" />
          <rect x="128" y="91" width="25" height="41" fill={palette.door} />
          <path d="M164 86 H193 V92 H164Z M164 96 H193 V102 H164Z" fill="#4e6370" />
          <path d="M165 102 L171 86 M178 102 L184 86 M191 102 L197 86" stroke="#e8e2d1" strokeWidth="2" />
          <path d="M148 36 L182 42 L178 48 L144 42Z M184 43 L205 47 L201 52 L181 48Z" fill="#647d8b" />
          <path d="M30 132 H222" stroke="#e8d9b8" strokeWidth="4" />
        </>
      )}

      {palette.style === "coastal" && (
        <>
          <path d="M56 73 L128 32 L202 73 V121 H56Z" fill={palette.wall} stroke="#896e5e" strokeWidth="2.5" />
          <path d="M47 75 L128 25 L211 75 L202 80 L128 37 L56 81Z" fill={palette.roof} stroke="#667d89" strokeWidth="2.5" />
          <path d="M52 78 Q128 91 206 78" fill="none" stroke="#f8f1dc" strokeWidth="4" />
          <path d="M64 81 V127 M194 81 V127 M67 116 H192" stroke="#fff3dd" strokeWidth="4" />
          <rect x="108" y="88" width="34" height="39" fill={palette.door} />
          <rect x="72" y="84" width="23" height="23" fill="#a9d5df" stroke="#fff3dd" strokeWidth="3" />
          <rect x="165" y="84" width="23" height="23" fill="#a9d5df" stroke="#fff3dd" strokeWidth="3" />
          <path d="M75 94 H92 M168 94 H185" stroke="#fff3dd" strokeWidth="2" />
          <path d="M55 130 Q128 125 202 130" fill="none" stroke="#876e59" strokeWidth="3" />
        </>
      )}

      {palette.style === "townhouse" && (
        <>
          <path d="M72 58 L131 24 L190 58 V132 H72Z" fill={palette.wall} stroke="#7c6e76" strokeWidth="2.5" />
          <path d="M62 60 L131 16 L200 60 L190 66 L131 29 L72 66Z" fill={palette.roof} stroke="#684854" strokeWidth="2.5" />
          <rect x="89" y="46" width="23" height="24" fill={palette.trim} stroke="#687b83" strokeWidth="2" />
          <rect x="149" y="46" width="23" height="24" fill={palette.trim} stroke="#687b83" strokeWidth="2" />
          <path d="M100 46 V70 M160 46 V70" stroke="#687b83" strokeWidth="2" />
          <rect x="82" y="79" width="33" height="27" fill={palette.trim} stroke="#687b83" strokeWidth="2" />
          <rect x="147" y="79" width="33" height="27" fill={palette.trim} stroke="#687b83" strokeWidth="2" />
          <path d="M98 79 V106 M163 79 V106 M78 108 H184 M82 108 V116 M98 108 V116 M114 108 V116 M130 108 V116 M146 108 V116 M162 108 V116 M180 108 V116" stroke="#806c72" strokeWidth="2" />
          <rect x="118" y="91" width="26" height="41" fill={palette.door} />
          <path d="M110 132 V120 H152 V132" fill="#c6a77d" />
        </>
      )}

      {palette.style === "bungalow" && (
        <>
          <path d="M46 75 L128 35 L212 75 L203 82 L128 48 L55 82Z" fill={palette.roof} stroke="#596f84" strokeWidth="2.5" />
          <path d="M60 80 H196 V124 H60Z" fill={palette.wall} stroke="#88765e" strokeWidth="2.5" />
          <path d="M54 78 H202 V85 H54Z" fill="#d7b17c" />
          <path d="M69 84 V127 M187 84 V127 M61 113 H195" stroke="#fff8e6" strokeWidth="3" />
          <rect x="111" y="91" width="31" height="36" fill={palette.door} />
          <rect x="76" y="91" width="22" height="19" fill={palette.trim} stroke="#6d8790" strokeWidth="2" />
          <rect x="165" y="91" width="18" height="19" fill={palette.trim} stroke="#6d8790" strokeWidth="2" />
          <path d="M73 130 H193" stroke="#b48a61" strokeWidth="4" />
          <path d="M51 76 H207" stroke="#f6e4c3" strokeWidth="3" strokeDasharray="4 4" />
        </>
      )}

      {palette.style === "courtyard" && (
        <>
          <path d="M48 71 L127 29 L206 71 V130 H48Z" fill={palette.wall} stroke="#81715b" strokeWidth="2.5" />
          <path d="M39 74 L127 22 L215 74 L206 80 L127 35 L48 80Z" fill={palette.roof} stroke="#604c40" strokeWidth="2.5" />
          <path d="M99 130 V102 Q127 72 155 102 V130Z" fill="#775d4e" />
          <path d="M107 130 V104 Q127 84 147 104 V130Z" fill="#f0d3ac" />
          <rect x="63" y="85" width="22" height="27" fill={palette.trim} stroke="#657873" strokeWidth="2" />
          <path d="M69 85 V112 M79 85 V112" stroke="#657873" strokeWidth="2" />
          <rect x="169" y="85" width="22" height="27" fill={palette.trim} stroke="#657873" strokeWidth="2" />
          <path d="M175 85 V112 M185 85 V112" stroke="#657873" strokeWidth="2" />
          <path d="M99 130 H155" stroke="#fff1d7" strokeWidth="3" />
          <path d="M41 132 H214" stroke="#cfb990" strokeWidth="3" />
        </>
      )}

      {palette.style === "farmhouse" && (
        <>
          <path d="M49 73 L126 30 L203 73 V130 H49Z" fill={palette.wall} stroke="#806a53" strokeWidth="2.5" />
          <path d="M40 76 L126 20 L212 76 L202 82 L126 34 L50 82Z" fill={palette.roof} stroke="#4f6772" strokeWidth="2.5" />
          <path d="M105 53 Q126 37 147 53 V76 H105Z" fill={palette.trim} stroke="#5e7680" strokeWidth="2" />
          <path d="M126 43 V76 M105 63 H147" stroke="#5e7680" strokeWidth="2" />
          <rect x="107" y="87" width="39" height="43" fill={palette.door} stroke="#654d42" strokeWidth="2" />
          <path d="M107 87 L126 77 L146 87" fill="#f4e4c9" stroke="#654d42" strokeWidth="2" />
          <circle cx="139" cy="108" r="2" fill="#f3cf79" />
          <rect x="62" y="85" width="23" height="25" fill={palette.trim} stroke="#68808a" strokeWidth="2" />
          <rect x="169" y="85" width="23" height="25" fill={palette.trim} stroke="#68808a" strokeWidth="2" />
          <path d="M51 77 H201" stroke="#d6ae75" strokeWidth="3" strokeDasharray="5 4" />
        </>
      )}

      {palette.style === "villa" && (
        <>
          <path d="M48 55 H207 V131 H48Z" fill={palette.wall} stroke="#786986" strokeWidth="2.5" />
          <path d="M39 51 H216 V61 H39Z" fill={palette.roof} />
          <path d="M68 29 H187 V50 H68Z" fill="#fff8ed" stroke="#786986" strokeWidth="2" />
          <path d="M75 32 H180 V47 H75Z" fill={palette.roof} opacity=".85" />
          <path d="M84 50 V67 M111 50 V67 M138 50 V67 M165 50 V67" stroke="#fff8ed" strokeWidth="3" />
          <rect x="63" y="77" width="44" height="32" fill="#a8d2d5" stroke="#fff8ed" strokeWidth="4" />
          <path d="M85 77 V109 M63 93 H107" stroke="#6b8290" strokeWidth="2" />
          <rect x="151" y="77" width="43" height="32" fill="#a8d2d5" stroke="#fff8ed" strokeWidth="4" />
          <path d="M172 77 V109 M151 93 H194" stroke="#6b8290" strokeWidth="2" />
          <path d="M113 131 V96 Q130 76 147 96 V131Z" fill={palette.door} stroke="#654f5e" strokeWidth="2" />
          <path d="M110 83 H199" stroke="#765d83" strokeWidth="3" />
        </>
      )}

      <path d="M22 133 V112 M16 119 Q22 103 28 119 M16 125 Q22 110 28 125" fill="#5f8b62" stroke="#4d7651" strokeWidth="2" />
      <path d="M232 133 V110 M226 118 Q232 101 238 118 M226 125 Q232 108 238 125" fill="#5f8b62" stroke="#4d7651" strokeWidth="2" />
      <path d="M28 140 Q130 136 232 140" fill="none" stroke="#f1e2c4" strokeWidth="2" opacity=".8" />
      <image
        href={`${import.meta.env.BASE_URL}house-previews/${photoFile}`}
        x="0"
        y="0"
        width="260"
        height="160"
        preserveAspectRatio="xMidYMid slice"
      />
    </svg>
  );
}

function FinanceList({ records, onRemove, money, empty }) {
  if (records.length === 0) return <p className="project-empty-state">{empty}</p>;
  return (
    <ul className="project-finance-list">
      {records.map((record) => (
        <li key={record.id}>
          <span><strong>{record.description}</strong><small>{record.date}</small></span>
          <strong>{money(record.amount)}</strong>
          <button type="button" aria-label={`Remove ${record.description}`} onClick={() => onRemove(record.id)}>Remove</button>
        </li>
      ))}
    </ul>
  );
}

export default ProjectDashboard;

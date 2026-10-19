
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import Login from "./Login";
import Signup from "./Signup";
import PasswordReset from "./PasswordReset";
import Home from "./Home";
import {
  getMeasurementProjectId,
  loadProjects,
  loadMeasurements,
  createProject,
  saveMeasurements,
  updateProject,
  deleteProject,
  getCurrentUser,
  logoutAccount,
} from "./measurementApi";

import AIChatWidget from "./components/AIChatWidget";



const ACTIVE_PROJECT_KEY = "paintwise.activeHouseProjectId";

function App() {
  const [resetToken] = useState(
    () => new URLSearchParams(window.location.search).get("reset_token") || ""
  );
  const [page, setPage] = useState(() => resetToken ? "reset" : "login");
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(() => Boolean(resetToken));
  const [authMessage, setAuthMessage] = useState(
    () => new URLSearchParams(window.location.search).get("auth_error") || ""
  );
  const [walls, setWalls] = useState([
    { id: 1, name: "Wall 1", length: "", height: "" },
  ]);
  const [openings, setOpenings] = useState([
    { id: 1, name: "Door", width: "", height: "", quantity: 1 },
  ]);
  const [coats, setCoats] = useState(2);
  const [coverage, setCoverage] = useState(100);
  const [paintableArea, setPaintableArea] = useState("");
  const [areaSource, setAreaSource] = useState("measurements");
  const [selectedPaintProduct, setSelectedPaintProduct] = useState("standard");
  const [workspaceId] = useState(getMeasurementProjectId);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(
    () => window.localStorage.getItem(ACTIVE_PROJECT_KEY) || ""
  );
  const [projectsStatus, setProjectsStatus] = useState("loading");
  const [projectsLoadAttempt, setProjectsLoadAttempt] = useState(0);
  const [projectActionError, setProjectActionError] = useState("");
  const [measurementsReady, setMeasurementsReady] = useState(false);
  const [loadedMeasurementProjectId, setLoadedMeasurementProjectId] =
    useState("");
  const [measurementStoreStatus, setMeasurementStoreStatus] = useState("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const saveQueueRef = useRef(Promise.resolve());
  const latestMeasurementsRef = useRef(null);
  const deletingMeasurementProjectIdRef = useRef("");
  const userId = user?.id;

  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (resetToken) {
      return undefined;
    }

    let current = true;
    getCurrentUser()
      .then((currentUser) => {
        if (!current) return;
        setUser(currentUser);
        if (currentUser) setPage("home");
        setAuthChecked(true);
      })
      .catch((error) => {
        if (!current) return;
        setAuthMessage(error.message || "Could not check your sign-in status.");
        setAuthChecked(true);
      });
    return () => {
      current = false;
    };
  }, [resetToken]);

  useEffect(() => {
    function handleUnauthorized() {
      setUser(null);
      setProjects([]);
      setActiveProjectId("");
      setMeasurementsReady(false);
      setLoadedMeasurementProjectId("");
      setPage("login");
      setAuthMessage("Your session has expired. Please sign in again.");
    }
    window.addEventListener("paintwise:unauthorized", handleUnauthorized);
    return () =>
      window.removeEventListener("paintwise:unauthorized", handleUnauthorized);
  }, []);

  const measurementData = useMemo(
    () => ({
      walls,
      openings,
      coats,
      coverage,
      paintableArea,
      areaSource,
      selectedPaintProduct,
    }),
    [
      walls,
      openings,
      coats,
      coverage,
      paintableArea,
      areaSource,
      selectedPaintProduct,
    ]
  );
  useEffect(() => {
    latestMeasurementsRef.current = { projectId: activeProjectId, data: measurementData };
  }, [activeProjectId, measurementData]);

  useEffect(() => {
    if (!userId) return undefined;
    let isCurrent = true;
    loadProjects(workspaceId)
      .then(({ projects: loadedProjects }) => {
        if (!isCurrent) return;
        setProjects(loadedProjects);
        if (loadedProjects.length === 0) {
          setActiveProjectId("");
          window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
          setProjectsStatus("ready");
          return;
        }
        const storedProjectId = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
        const nextProjectId = loadedProjects.some(
          (project) => project.id === storedProjectId
        )
          ? storedProjectId
          : loadedProjects[0]?.id;
        if (nextProjectId) {
          setActiveProjectId(nextProjectId);
          window.localStorage.setItem(ACTIVE_PROJECT_KEY, nextProjectId);
        }
        setProjectsStatus("ready");
      })
      .catch((error) => {
        if (!isCurrent) return;
        console.error("Could not load house projects.", error);
        setProjectsStatus("error");
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId, projectsLoadAttempt, userId]);

  useEffect(() => {
    let isCurrent = true;
    if (!activeProjectId || projectsStatus !== "ready") return undefined;
    loadMeasurements(activeProjectId)
      .then(({ measurements }) => {
        if (!isCurrent) return;
        if (measurements) {
          setWalls(measurements.walls);
          setOpenings(measurements.openings);
          setCoats(measurements.coats);
          setCoverage(measurements.coverage);
          setPaintableArea(measurements.paintableArea);
          setAreaSource(measurements.areaSource);
          setSelectedPaintProduct(measurements.selectedPaintProduct);
        } else {
          setWalls([{ id: 1, name: "Wall 1", length: "", height: "" }]);
          setOpenings([
            { id: 1, name: "Door", width: "", height: "", quantity: 1 },
          ]);
          setCoats(2);
          setCoverage(100);
          setPaintableArea("");
          setAreaSource("measurements");
          setSelectedPaintProduct("standard");
        }
        setLoadedMeasurementProjectId(activeProjectId);
        setMeasurementsReady(true);
        setMeasurementStoreStatus("ready");
      })
      .catch(() => {
        if (isCurrent) setMeasurementStoreStatus("load-error");
      });

    return () => {
      isCurrent = false;
    };
  }, [activeProjectId, projectsStatus, loadAttempt]);

  useEffect(() => {
    if (
      !measurementsReady ||
      loadedMeasurementProjectId !== activeProjectId ||
      !activeProjectId
    ) return undefined;
    const snapshot = {
      walls,
      openings,
      coats,
      coverage,
      paintableArea,
      areaSource,
      selectedPaintProduct,
    };
    let isCurrent = true;
    const timer = window.setTimeout(() => {
      if (deletingMeasurementProjectIdRef.current === activeProjectId) return;
      setMeasurementStoreStatus("saving");
      const queuedSave = saveQueueRef.current
        .catch(() => {})
        .then(() => saveMeasurements(activeProjectId, snapshot));
      saveQueueRef.current = queuedSave;
      queuedSave
        .then(() => {
          if (isCurrent) setMeasurementStoreStatus("saved");
        })
        .catch(() => {
          if (isCurrent) setMeasurementStoreStatus("save-error");
        });
    }, 400);

    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
    };
  }, [
    measurementsReady,
    saveAttempt,
    activeProjectId,
    loadedMeasurementProjectId,
    walls,
    openings,
    coats,
    coverage,
    paintableArea,
    areaSource,
    selectedPaintProduct,
  ]);

  useEffect(() => {
    function saveOnPageExit() {
      const latest = latestMeasurementsRef.current;
      if (
        deletingMeasurementProjectIdRef.current === activeProjectId ||
        !measurementsReady ||
        loadedMeasurementProjectId !== activeProjectId ||
        latest?.projectId !== activeProjectId
      ) return;
      void saveMeasurements(activeProjectId, latest.data, true).catch(
        (error) => {
          console.error("Could not save measurements while leaving the page.", error);
        }
      );
    }

    window.addEventListener("pagehide", saveOnPageExit);
    return () => window.removeEventListener("pagehide", saveOnPageExit);
  }, [measurementsReady, loadedMeasurementProjectId, activeProjectId]);

  function selectProject(projectId) {
    if (projectId === activeProjectId) return;
    if (
      deletingMeasurementProjectIdRef.current !== activeProjectId &&
      measurementsReady &&
      loadedMeasurementProjectId === activeProjectId
    ) {
      const queuedSave = saveQueueRef.current
        .catch(() => {})
        .then(() => saveMeasurements(activeProjectId, measurementData));
      saveQueueRef.current = queuedSave;
      queuedSave.catch((error) => {
        console.error("Could not save measurements before switching houses.", error);
      });
    }
    setProjectActionError("");
    setMeasurementsReady(false);
    setMeasurementStoreStatus("loading");
    setActiveProjectId(projectId);
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
  }

  async function handleCreateProject(project) {
    setProjectActionError("");
    try {
      const { project: createdProject } = await createProject(workspaceId, project);
      setProjects((current) => [...current, createdProject]);
      selectProject(createdProject.id);
    } catch (error) {
      console.error("Could not create house project.", error);
      setProjectActionError(error.message);
      throw error;
    }
  }

  async function handleUpdateProject(project) {
    if (!activeProjectId) return;
    setProjectActionError("");
    try {
      const { project: updatedProject } = await updateProject(
        workspaceId,
        activeProjectId,
        project
      );
      setProjects((current) =>
        current.map((item) =>
          item.id === updatedProject.id ? updatedProject : item
        )
      );
    } catch (error) {
      console.error("Could not update house project.", error);
      setProjectActionError(error.message);
      throw error;
    }
  }

  async function handleDeleteProject(projectId) {
    setProjectActionError("");
    const deletingActiveProject = activeProjectId === projectId;
    if (deletingActiveProject) {
      deletingMeasurementProjectIdRef.current = projectId;
      await saveQueueRef.current.catch(() => {});
    }
    try {
      await deleteProject(workspaceId, projectId);
      const remainingProjects = projects.filter(
        (project) => project.id !== projectId
      );
      setProjects(remainingProjects);
      if (deletingActiveProject && remainingProjects.length > 0) {
        const nextProject = remainingProjects[0];
        setMeasurementsReady(false);
        setLoadedMeasurementProjectId("");
        setMeasurementStoreStatus("loading");
        setActiveProjectId(nextProject.id);
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, nextProject.id);
      } else if (deletingActiveProject) {
        setMeasurementsReady(false);
        setLoadedMeasurementProjectId("");
        setMeasurementStoreStatus("loading");
        setActiveProjectId("");
        window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
      }
    } catch (error) {
      console.error("Could not delete house project.", error);
      setProjectActionError(error.message);
      if (deletingActiveProject) {
        deletingMeasurementProjectIdRef.current = "";
        setSaveAttempt((attempt) => attempt + 1);
      }
      throw error;
    }
  }

  function retryMeasurementSync() {
    if (measurementStoreStatus === "load-error") {
      setMeasurementsReady(false);
      setMeasurementStoreStatus("loading");
      setLoadAttempt((attempt) => attempt + 1);
    } else {
      setMeasurementStoreStatus("ready");
      setSaveAttempt((attempt) => attempt + 1);
    }
  }

  function flushActiveMeasurements(snapshot) {
    if (
      !activeProjectId ||
      loadedMeasurementProjectId !== activeProjectId ||
      !measurementsReady
    ) {
      return Promise.reject(new Error("This house’s measurements are not ready to export."));
    }
    const queuedSave = saveQueueRef.current
      .catch(() => {})
      .then(() => saveMeasurements(activeProjectId, snapshot));
    saveQueueRef.current = queuedSave;
    return queuedSave;
  }

  function handleAuthenticationSuccess(authenticatedUser) {
    setUser(authenticatedUser);
    setAuthMessage("");
    setProjects([]);
    setActiveProjectId("");
    setMeasurementsReady(false);
    setLoadedMeasurementProjectId("");
    setProjectsStatus("loading");
    setPage("home");
  }

  async function handleLogout() {
    if (
      activeProjectId &&
      measurementsReady &&
      loadedMeasurementProjectId === activeProjectId
    ) {
      try {
        await saveQueueRef.current;
      } catch (error) {
        console.error("Could not finish queued measurement saves.", error);
        setAuthMessage("Your recent measurement changes could not be saved. Please retry before signing out.");
        throw error;
      }
      const latest = latestMeasurementsRef.current;
      if (latest?.projectId === activeProjectId) {
        try {
          await saveMeasurements(activeProjectId, latest.data);
        } catch (error) {
          console.error("Could not save measurements before sign out.", error);
          setAuthMessage("Your recent measurement changes could not be saved. Please retry before signing out.");
          throw error;
        }
      }
    }
    try {
      await logoutAccount();
    } catch (error) {
      setAuthMessage(error.message || "Could not sign out. Please try again.");
      throw error;
    }
    setUser(null);
    setProjects([]);
    setActiveProjectId("");
    setMeasurementsReady(false);
    setLoadedMeasurementProjectId("");
    setAuthMessage("");
    setPage("login");
  }

  return (
    <>
      {!authChecked && (
        <main className="workspace-loading" role="status">
          Checking your sign-in…
        </main>
      )}
      {authChecked && page === "login" && (
        <Login
          onSignupClick={() => setPage("signup")}
          onLoginSuccess={handleAuthenticationSuccess}
          initialMessage={authMessage}
        />
      )}

      {authChecked && page === "signup" && (
        <Signup
          onLoginClick={() => setPage("login")}
          onSignupSuccess={handleAuthenticationSuccess}
        />
      )}

      {authChecked && page === "reset" && (
        <PasswordReset
          token={resetToken}
          onCancel={() => setPage("login")}
          onComplete={() => {
            setAuthMessage("Your password has been reset. Please sign in.");
            setPage("login");
          }}
        />
      )}

      {authChecked && user && page !== "login" && page !== "signup" && page !== "reset" && (
        projectsStatus === "loading" ? (
          <main className="workspace-loading" role="status">Loading your house projects…</main>
        ) : projectsStatus === "error" ? (
          <main className="workspace-loading" role="alert">
            Could not load house projects.{" "}
            <button onClick={() => {
              setProjectsStatus("loading");
              setProjectsLoadAttempt((attempt) => attempt + 1);
            }}>
              Retry
            </button>
          </main>
        ) : activeProjectId && activeProjectId !== loadedMeasurementProjectId &&
          measurementStoreStatus === "load-error" ? (
          <main className="workspace-loading" role="alert">
            Could not load this house’s measurements.{" "}
            <button onClick={retryMeasurementSync}>Retry</button>
          </main>
        ) : activeProjectId && activeProjectId !== loadedMeasurementProjectId ? (
          <main className="workspace-loading" role="status">Loading this house’s measurements…</main>
        ) : (
        <Home
          key={activeProjectId || "no-house"}
          onLogout={handleLogout}
          authError={authMessage}
          onNavigate={setPage}
          initialSection={page}
          walls={walls}
          setWalls={setWalls}
          openings={openings}
          setOpenings={setOpenings}
          coats={coats}
          setCoats={setCoats}
          coverage={coverage}
          setCoverage={setCoverage}
          paintableArea={paintableArea}
          setPaintableArea={setPaintableArea}
          areaSource={areaSource}
          setAreaSource={setAreaSource}
          selectedPaintProduct={selectedPaintProduct}
          setSelectedPaintProduct={setSelectedPaintProduct}
          measurementStoreStatus={measurementStoreStatus}
          onRetryMeasurementSync={retryMeasurementSync}
          onFlushMeasurements={flushActiveMeasurements}
          projectId={activeProjectId}
          workspaceId={workspaceId}
          projects={projects}
          activeProject={projects.find((project) => project.id === activeProjectId) || null}
          onSelectProject={selectProject}
          onCreateProject={handleCreateProject}
          onUpdateProject={handleUpdateProject}
          onDeleteProject={handleDeleteProject}
          projectActionError={projectActionError}
        />
        )
      )}
      {user && <AIChatWidget />}
    </>
  );
}

export default App;

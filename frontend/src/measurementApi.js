const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/$/,
  ""
);
const PROJECT_ID_KEY = "paintwise.measurementProjectId";

export function getMeasurementProjectId() {
  const existingId = window.localStorage.getItem(PROJECT_ID_KEY);
  const isUuid =
    existingId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      existingId
    );
  if (isUuid) {
    return existingId;
  }

  const projectId = crypto.randomUUID();
  window.localStorage.setItem(PROJECT_ID_KEY, projectId);
  return projectId;
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (response.status === 405) {
      throw new Error(
        "The API server does not support this request yet. Restart the backend server and try again."
      );
    }
    throw new Error(
      `The API server returned a non-JSON response (HTTP ${response.status}). Check that the backend is running and its /api routes are reachable.`
    );
  }

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "The measurement service returned an error.");
  }
  return result;
}

function measurementsUrl(projectId) {
  return `${API_BASE_URL}/measurements/${encodeURIComponent(projectId)}`;
}

function attendanceUrl(projectId, weekStart) {
  return `${API_BASE_URL}/attendance/${encodeURIComponent(projectId)}?week_start=${encodeURIComponent(weekStart)}`;
}

export async function loadMeasurements(projectId) {
  const response = await fetch(measurementsUrl(projectId));
  return parseResponse(response);
}

export async function loadWeeklyAttendance(projectId, weekStart) {
  const response = await fetch(attendanceUrl(projectId, weekStart));
  return parseResponse(response);
}

export async function saveWeeklyAttendance(
  projectId,
  weekStart,
  labourers,
  keepalive = false
) {
  const response = await fetch(
    `${API_BASE_URL}/attendance/${encodeURIComponent(projectId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart, labourers }),
      keepalive,
    }
  );
  return parseResponse(response);
}

export async function saveMeasurements(
  projectId,
  measurements,
  keepalive = false
) {
  const response = await fetch(measurementsUrl(projectId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(measurements),
    keepalive,
  });
  return parseResponse(response);
}

function projectsUrl(workspaceId) {
  return `${API_BASE_URL}/projects/${encodeURIComponent(workspaceId)}`;
}

function projectUrl(workspaceId, projectId) {
  return `${projectsUrl(workspaceId)}/${encodeURIComponent(projectId)}`;
}

export async function loadProjects(workspaceId) {
  const response = await fetch(projectsUrl(workspaceId));
  return parseResponse(response);
}

export async function createProject(workspaceId, project) {
  const response = await fetch(projectsUrl(workspaceId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  return parseResponse(response);
}

export async function updateProject(workspaceId, projectId, project) {
  const response = await fetch(projectUrl(workspaceId, projectId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  return parseResponse(response);
}

export async function deleteProject(workspaceId, projectId) {
  const response = await fetch(projectUrl(workspaceId, projectId), {
    method: "DELETE",
  });
  return parseResponse(response);
}

export async function loadProjectData(workspaceId, projectId) {
  const response = await fetch(`${projectUrl(workspaceId, projectId)}/data`);
  return parseResponse(response);
}

export async function saveProjectData(
  workspaceId,
  projectId,
  data,
  keepalive = false
) {
  const response = await fetch(`${projectUrl(workspaceId, projectId)}/data`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    keepalive,
  });
  return parseResponse(response);
}

export async function loadBusinessSummary(workspaceId) {
  const response = await fetch(`${projectsUrl(workspaceId)}/summary`);
  return parseResponse(response);
}

export async function exportProject(workspaceId, projectId) {
  const response = await fetch(`${projectUrl(workspaceId, projectId)}/export`);
  return parseResponse(response);
}

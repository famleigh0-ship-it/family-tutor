async function authedFetch(session, path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers
    }
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return body
}

export function checkPinStatus(session) {
  return authedFetch(session, '/api/parent-pin/status')
}

export function setParentPin(session, pin) {
  return authedFetch(session, '/api/parent-pin/set', {
    method: 'POST',
    body: JSON.stringify({ pin })
  })
}

export function verifyParentPin(session, pin) {
  return authedFetch(session, '/api/parent-pin/verify', {
    method: 'POST',
    body: JSON.stringify({ pin })
  })
}

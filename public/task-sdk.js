export function createKbTask(taskId) {
  function send(moveType, payload = {}, penalty = 0) {
    window.parent.postMessage(
      { kind: 'kb_move', taskId, moveType, payload, penalty },
      window.location.origin
    );
  }

  function finish(payload = {}) {
    window.parent.postMessage({ kind: 'kb_finish', taskId, payload }, window.location.origin);
  }

  function click(payload = {}) {
    send('click', payload, 0);
  }

  return { send, click, finish, taskId };
}


'use strict';
window.agent.onSessionInfo((info) => {
  document.getElementById('txt').textContent =
    (info.control ? 'Controllo remoto attivo' : 'Condivisione schermo attiva') +
    ' · ' + (info.viewerName || 'Operatore');
});
document.getElementById('stop').onclick = () => window.agent.forceStop();

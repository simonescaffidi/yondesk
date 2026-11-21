# Relay TURN di Yondesk

Quando i due dispositivi non riescono a collegarsi direttamente (reti aziendali, reti mobili, NAT restrittivi)
la sessione passa da questo relay. I contenuti restano cifrati end-to-end: il relay inoltra pacchetti che non può leggere.

- Immagine: `coturn` avviato da `entrypoint.sh`.
- I client si collegano al relay **solo in TCP** (su Railway: TCP Proxy verso la porta 3478).
- Il relay inoltra traffico **solo tra due client collegati a lui stesso**: non può essere usato come proxy
  verso internet o verso la rete interna (tutti gli altri indirizzi sono vietati).
- Credenziali temporanee: il server Yondesk le genera a ogni richiesta di `/api/ice` con `TURN_SECRET`
  (stesso valore su questo servizio e sul server), valide 6 ore.

Variabili: `TURN_SECRET` (obbligatoria), `TURN_PORT` (default 3478), `TURN_REALM` (default yondesk.com).
Sul server Yondesk: `TURN_URLS=turn:<host-proxy>:<porta>?transport=tcp` e `TURN_SECRET`.

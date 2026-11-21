# Scheda Google Play di Yondesk

Pacchetto `it.simonescaffidi.yondesk`. Lingua predefinita: italiano. Categoria: Strumenti. App gratuita, senza annunci.
Grafiche in questa cartella: `icon-512.png`, `feature-graphic-1024x500.png`, `screenshot-*.png` (1-3 a 900x1600 dall'app in sessione reale, 4-5 a 1080x2160 dall'emulatore Android 14).

## Italiano (it-IT)

**Nome app** (30): Yondesk - assistenza remota

**Descrizione breve** (80): Assistenza e controllo remoto, cifrato e sempre con il consenso di chi è aiutato

**Descrizione completa**

Yondesk collega chi ha bisogno di aiuto con chi lo fornisce: dal telefono vedi e controlli un computer lontano, oppure mostri lo schermo del tuo telefono a un tecnico di fiducia.

COSA PUOI FARE
• Offrire assistenza: inserisci l'ID di 9 cifre e la password del dispositivo remoto e ne vedi lo schermo. Se l'altra persona lo consente, il telefono diventa un touchpad: tocco, doppio tocco, clic destro, trascinamento e tastiera.
• Farti assistere: l'app mostra il tuo ID e una password che cambia a ogni sessione. Quando l'operatore chiede di collegarsi decidi tu se accettare, poi Android ti chiede di autorizzare la condivisione dello schermo.
• Funziona con le app Yondesk per Windows, macOS e Linux e con il client web, senza registrazione.

SEMPRE CON IL TUO CONSENSO
• Nessuna sessione parte senza che tu la accetti.
• Mentre condividi lo schermo restano visibili una barra rossa nell'app e una notifica di sistema, e chiudi tutto con un tocco su Termina.
• Dal telefono l'operatore vede soltanto: non può toccare o comandare il tuo dispositivo.

PRIVACY
• Schermo e comandi viaggiano cifrati da un capo all'altro (WebRTC): il server di Yondesk mette in contatto i due dispositivi ma non può vedere i contenuti.
• Nessun account, nessuna pubblicità, nessun tracciamento.
• Software libero con licenza MIT: il codice è pubblico su GitHub.

A CHI SERVE
Consulenti informatici, help desk, e chiunque debba dare una mano a un familiare o a un collega a distanza.

## English (en-US)

**App name**: Yondesk - Remote Support

**Short description**: Remote support and remote control, encrypted and always consent-based

**Full description**

Yondesk connects people who need help with those who provide it: from your phone you can view and control a remote computer, or show your phone's screen to a technician you trust.

WHAT YOU CAN DO
• Give support: enter the 9-digit ID and the password of the remote device to see its screen. If the other person allows it, your phone becomes a touchpad: tap, double tap, right click, drag and keyboard.
• Get support: the app shows your ID and a password that changes every session. When the operator asks to connect you decide whether to accept, then Android asks you to authorise screen sharing.
• Works with the Yondesk apps for Windows, macOS and Linux and with the web client, with no sign-up.

ALWAYS WITH YOUR CONSENT
• No session starts unless you accept it.
• While you share your screen a red bar in the app and a system notification stay visible, and one tap on End stops everything.
• From a phone the operator can only watch: they cannot touch or control your device.

PRIVACY
• Screen and input travel end-to-end encrypted (WebRTC): the Yondesk server puts the two devices in touch but cannot see the content.
• No account, no ads, no tracking.
• Free software under the MIT license: the source code is public on GitHub.

WHO IT IS FOR
IT consultants, help desks, and anyone who needs to help a relative or a colleague remotely.

## Dichiarazioni da compilare in Play Console

- **Privacy policy**: https://yondesk.com/it/privacy-policy.html
- **Accesso all'app**: tutte le funzioni disponibili senza credenziali. Per provare: aprire https://yondesk.com/it/demo.html su un computer, scegliere "Mi fanno assistenza" e inserire nell'app ID e password mostrati.
- **Annunci**: no.
- **Classificazione dei contenuti**: utilità, nessun contenuto sensibile, nessuna interazione tra sconosciuti (serve ID e password dati a voce).
- **Pubblico di destinazione**: 18+.
- **Sicurezza dei dati**: nessun dato raccolto o condiviso con terzi; i dati in transito sono cifrati. L'identificativo del dispositivo generato dall'app serve solo a instradare la sessione e non è associato a una persona.
- **Servizio in primo piano (FOREGROUND_SERVICE_MEDIA_PROJECTION)**: usato solo mentre l'utente condivide lo schermo dopo aver accettato la richiesta dell'operatore e la finestra di sistema di Android; la notifica resta visibile e la condivisione si chiude con Termina. Video dimostrativo: https://yondesk.com/video/condivisione-android.mp4 (ID e password, finestra di sistema di Android, condivisione attiva con barra rossa, chiusura), composto dalle istantanee della prova su emulatore.
- **App di notizie, salute, finanza, governo**: no.

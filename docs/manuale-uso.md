# Yondesk — Manuale d'uso

## Cos'è
Yondesk collega chi ha bisogno di assistenza (**assistito**) con chi la fornisce (**operatore**), per vedere e controllare lo schermo da remoto in modo sicuro. Funziona su Windows, macOS, Linux, Android, iOS e nel browser.

## Demo guidata (un solo dispositivo)
Se non hai due dispositivi, nella pagina **Demo** premi **"Guarda la demo guidata"**: parte una simulazione di ~15 secondi che mostra consenso, schermo remoto, cursore dell'operatore, chat e invio file, per capire subito come funziona una sessione.

## Avvio rapido (browser, senza installare nulla)
1. Apri la pagina **Demo** del sito su entrambi i dispositivi.
2. Sul dispositivo da assistere scegli **"Mi fanno assistenza"**: compaiono **ID** e **password**.
3. Sull'altro scegli **"Offro assistenza"**, inserisci ID e password e premi **Connetti**.
4. Sull'assistito appare la richiesta di consenso: scegli **Consenti** o **Solo visione**.
5. Il browser chiede quale schermo/scheda condividere. Durante la sessione resta visibile un **banner** in alto.

## App desktop (controllo completo)
L'app nativa (Windows, macOS, Linux) fa sia da **operatore** sia da **assistito** e abilita il controllo reale di mouse e tastiera e l'accesso non presidiato. macOS: `.dmg` per Apple Silicon (arm64) e Intel (x64).

### Farsi assistere (assistito)
1. Scarica l'app dalla pagina **Download** per il tuo sistema.
2. All'avvio, scheda **"Fatti assistere"**: l'app mostra **ID** (sempre lo stesso su quel computer) e **password sessione** (cambia a ogni sessione).
3. Comunica ID e password all'operatore. Quando arriva la richiesta la finestra di Yondesk torna in primo piano: scegli **Consenti controllo**, **Solo visione** o **Rifiuta**.
4. Per terminare: pulsante **Termina sessione** nell'app o **Termina** nel banner in alto sullo schermo.

L'app resta attiva nell'area di notifica (tray) anche a finestra chiusa: per riaprirla clicca l'icona o avvia di nuovo Yondesk. Si gestisce una sessione alla volta: se un secondo operatore prova a collegarsi vede "Dispositivo occupato".

### Offrire assistenza (operatore)
1. Apri l'app, scheda **"Offri assistenza"**.
2. Inserisci **ID** e **password** del dispositivo remoto e premi **Connetti**.
3. Si apre una finestra con lo schermo remoto: muovi il mouse, scrivi, usa scorciatoie (es. Ctrl+C), rotella e doppio clic. Il controllo parte solo se l'altra persona lo consente; in sola visione vedi lo schermo senza poter agire.
4. Pulsanti: **Appunti** (scrive sul PC remoto il testo che hai negli appunti), schermo intero, **Termina**.

Messaggi che puoi vedere: *Password errata*, *Dispositivo non in linea*, *Richiesta rifiutata*, *Dispositivo occupato in un'altra sessione*, *Il dispositivo remoto non può condividere lo schermo* (permesso di cattura mancante).

### Primo avvio su macOS (app non ancora notarizzata)
L'app non è ancora firmata/notarizzata da Apple: al primo avvio macOS la blocca ("impossibile verificare che non contenga malware" / "danneggiata"). Non è un virus. Per aprirla: trascina **Yondesk** in *Applicazioni*, poi **clic destro sull'app → Apri → Apri** (solo la prima volta). Se compare ancora "danneggiata", nel *Terminale*: `xattr -dr com.apple.quarantine /Applications/Yondesk.app` e riavvia.

### Primo avvio su Windows (app non ancora firmata)
L'app non è ancora firmata, quindi **SmartScreen** può mostrare un avviso blu ("Windows ha protetto il PC"). Non è un virus. Per aprirla: **Ulteriori informazioni → Esegui comunque**. Consiglio: usa la versione **Portable**, che gira senza installare nulla.

### Permessi di sistema
- **macOS**: per farti assistere servono *Registrazione schermo* (per mostrare lo schermo) e *Accessibilità* (per far controllare mouse e tastiera). Se mancano, l'app mostra un riquadro giallo con i pulsanti che aprono la pagina giusta di Impostazioni → Privacy e sicurezza; dopo aver attivato *Registrazione schermo* riavvia Yondesk.
- **Windows**: nessuna configurazione. Le finestre aperte "come amministratore" non si possono controllare da remoto se Yondesk non è avviato a sua volta come amministratore.
- **Linux**: l'AppImage richiede `libfuse2` (su Ubuntu 22.04 e successivi: `sudo apt install libfuse2`), poi `chmod +x Yondesk.AppImage`. Il controllo di mouse e tastiera funziona nelle sessioni X11; con Wayland è disponibile la sola visione tramite la condivisione schermo del sistema.

### Accesso non presidiato (opzionale)
Per collegarti ai tuoi PC/server senza che nessuno accetti:
1. Nell'app attiva **"Accesso non presidiato"** e imposta una **password dedicata** (min. 6 caratteri).
2. Da quel momento un operatore con ID + password dedicata si collega senza conferma manuale.
3. Durante ogni sessione resta comunque **un banner visibile** e l'icona nella tray.

## App mobile (Android e iOS)
### Offrire assistenza dal telefono
1. Scheda **"Offri assistenza"**: inserisci l'**ID** di 9 cifre e la **password** del dispositivo remoto, poi **Connetti**.
2. Quando l'altra persona accetta vedi il suo schermo. Se ha consentito il controllo, lo schermo del telefono diventa un touchpad:
   - **tocco** = clic nel punto toccato
   - **doppio tocco** = doppio clic
   - **pressione lunga** = clic con il tasto destro
   - **trascinamento** = trascina (tasto premuto)
   - icona **tastiera** in alto: scrivi testo e invia i tasti Invio, ⌫, Tab, Esc e frecce
3. **Termina** chiude la sessione.

### Farsi assistere dal telefono (Android)
1. Scheda **"Fatti assistere"** → **Ricevi assistenza**: compaiono **ID** e **password** da comunicare all'operatore.
2. Alla richiesta dell'operatore premi **Consenti**; Android chiede di autorizzare la condivisione: scegli **Tutto lo schermo** e avvia.
3. Per tutta la sessione restano visibili la barra rossa nell'app e una **notifica** di sistema. Puoi usare le altre app: l'operatore vede lo schermo ma non può toccarlo. **Termina** chiude la condivisione.

Su iPhone e iPad l'app funziona come operatore; la condivisione dello schermo del telefono è disponibile su Android.

## Funzioni in sessione
- **App desktop**: schermo remoto, controllo di mouse e tastiera, invio degli appunti come testo, schermo intero.
- **App mobile**: schermo remoto e controllo touch con tastiera.
- **Client web (pagina Demo)**: schermo remoto, cursore dell'operatore visibile all'assistito, **chat**, **invio file** diretto e cifrato in entrambe le direzioni, qualità bassa / bilanciata / alta. Dal browser non si controllano mouse e tastiera: per il controllo usa l'app.
- I diversi client si collegano tra loro: per esempio operatore dal browser o dal telefono verso un computer con l'app desktop.

## Sicurezza e privacy
- I contenuti (schermo, input, file, chat) sono **cifrati end-to-end**: il server non può vederli.
- La password è verificata sul dispositivo assistito, non dal server.
- Dopo troppi tentativi errati l'ID viene bloccato temporaneamente.
- Vedi Privacy Policy e Cookie Policy sul sito.

## Problemi comuni
| Problema | Soluzione |
|----------|-----------|
| "Dispositivo non in linea" | L'assistito non ha l'app aperta o manca connessione. |
| Schermo nero su macOS | Manca il permesso *Registrazione schermo*: attivalo e riavvia Yondesk. |
| Su macOS l'operatore vede ma non controlla | Manca il permesso *Accessibilità*. |
| L'AppImage non parte su Linux | Installa `libfuse2` e rendi eseguibile il file. |
| Android non avvia la condivisione | Nella finestra di sistema scegli *Tutto lo schermo*; se rifiuti, l'operatore vede "non può condividere lo schermo". |
| Reti aziendali o mobili che bloccano il collegamento diretto | Nessuna azione: la sessione passa in automatico dal relay di Yondesk, sempre cifrata da un capo all'altro. Può risultare un po' meno fluida. |
| Password errata ripetuta → blocco | Attendere qualche minuto e riprovare. |

---
Powered by www.simonescaffidi.it

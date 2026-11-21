# Relay TURN per Yondesk (reti con NAT restrittivi), pensato per Railway:
# i client raggiungono il relay solo in TCP (TCP Proxy di Railway) e i due lati di una
# sessione si incontrano dentro il relay. Vedi turn/README.md.
FROM coturn/coturn:4.6-alpine
USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER nobody:nogroup
EXPOSE 3478/tcp
ENTRYPOINT ["/entrypoint.sh"]

FROM debian:bookworm

ENV DEBIAN_FRONTEND=noninteractive

# 1. Install prerequisites
RUN apt-get update && apt-get install -y --no-install-recommends \
    apt-transport-https ca-certificates curl gnupg2 lsb-release build-essential cmake pkg-config autoconf libtool git libwebsockets-dev \
    && rm -rf /var/lib/apt/lists/*

# 2. Setup Authenticated SignalWire Repository
ARG TOKEN=pat_A7X9UwXZq84SCAZG4JyfZwf7
RUN echo "machine freeswitch.signalwire.com login signalwire password $TOKEN" > /etc/apt/auth.conf
RUN curl -u signalwire:$TOKEN -fSsL https://freeswitch.signalwire.com/repo/deb/debian-release/signalwire-freeswitch-repo.gpg | gpg --yes --dearmor -o /usr/share/keyrings/signalwire-freeswitch-repo.gpg
RUN echo "deb [signed-by=/usr/share/keyrings/signalwire-freeswitch-repo.gpg] https://freeswitch.signalwire.com/repo/deb/debian-release/ bookworm main" > /etc/apt/sources.list.d/freeswitch.list

RUN apt-get update

# 3. Install FreeSWITCH Core
RUN apt-get install -y freeswitch-all freeswitch-all-dev

# 4. Clone and build mod_audio_fork
WORKDIR /usr/src
RUN git clone https://github.com/nokeedev/mod_audio_fork.git
WORKDIR /usr/src/mod_audio_fork
RUN make && make install

# 5. Enable the module in FreeSWITCH
RUN sed -i '/<load module="mod_sofia"\/>/a \    <load module="mod_audio_fork"/>' /etc/freeswitch/autoload_configs/modules.conf.xml

CMD ["freeswitch", "-nonat", "-ncwait"]

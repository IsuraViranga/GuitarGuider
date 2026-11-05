# Jenkins for Melantha Guitar Academy: Jenkins LTS with the plugins below, set up from casc.yaml
# (no setup wizard), and the Docker command line, so each pipeline step runs in its own clean
# container (Python, PostgreSQL, Node, gitleaks). See jenkins/README.md.
FROM jenkins/jenkins:2.580.1-lts-jdk21

COPY --from=docker:28.0.4-cli /usr/local/bin/docker /usr/local/bin/docker

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

COPY casc.yaml /usr/share/jenkins/ref/casc.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/casc.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false"

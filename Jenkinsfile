// CI/CD for Melantha Guitar Academy (how to set it up: jenkins/README.md).
//
// Every branch and pull request:  secret scan → server checks and tests (PostgreSQL 18, like Neon)
//                                 and app checks and tests, side by side.
// main only, when DEPLOY_ENABLED=yes, after those pass:
//   deploy staging → smoke test staging → the owner approves → deploy production
//   → smoke test production (failed: offer a rollback to the previous version).
// Pull-request builds never receive deploy keys: they are used only in the main-only stages.

def onMainWithDeploys() {
  return env.BRANCH_NAME == 'main' && env.DEPLOY_ENABLED == 'yes'
}

def deployKeys(String environment) {
  return [
    string(credentialsId: 'render-api-key', variable: 'RENDER_API_KEY'),
    string(credentialsId: 'netlify-auth-token', variable: 'NETLIFY_AUTH_TOKEN'),
    string(credentialsId: "${environment}-render-service-id", variable: 'RENDER_SERVICE_ID'),
    string(credentialsId: "${environment}-netlify-site-id", variable: 'NETLIFY_SITE_ID'),
  ]
}

pipeline {
  agent none
  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '30'))
  }
  environment {
    CI = 'true'
  }

  stages {
    stage('Secret scan') {
      agent { docker { image 'zricethezav/gitleaks:v8.30.1'; args '--entrypoint=' } }
      environment {
        // The workspace belongs to another user inside the container: let git read it.
        GIT_CONFIG_COUNT = '1'
        GIT_CONFIG_KEY_0 = 'safe.directory'
        GIT_CONFIG_VALUE_0 = '*'
      }
      options { timeout(time: 10, unit: 'MINUTES') }
      steps {
        sh 'gitleaks git --redact --no-banner --config .gitleaks.toml .'
      }
    }

    stage('Checks and tests') {
      parallel {
        stage('Server') {
          agent any
          options { timeout(time: 30, unit: 'MINUTES') }
          steps {
            script {
              docker.image('postgres:18').withRun('-e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=guitar_test') { db ->
                docker.image('python:3.13-slim').inside("--link ${db.id}:db -e HOME=/tmp") {
                  sh '''
                    python -m venv /tmp/venv
                    /tmp/venv/bin/pip install --quiet --disable-pip-version-check -r backend/requirements-dev.txt
                    for i in $(seq 1 30); do
                      /tmp/venv/bin/python -c "import psycopg; psycopg.connect('postgresql://postgres@db:5432/guitar_test')" 2>/dev/null && break
                      sleep 1
                    done
                    TEST_DATABASE_URL=postgresql://postgres@db:5432/guitar_test PYTHON=/tmp/venv/bin/python bash scripts/ci.sh backend
                  '''
                }
              }
            }
          }
        }
        stage('App') {
          agent { docker { image 'node:22-bookworm'; args '-e HOME=/tmp' } }
          options { timeout(time: 30, unit: 'MINUTES') }
          steps {
            sh 'bash scripts/ci.sh frontend'
          }
        }
      }
    }

    stage('Deploy to staging') {
      when { expression { onMainWithDeploys() } }
      agent { dockerfile { dir 'jenkins/tools'; args '-e HOME=/tmp' } }
      options { timeout(time: 30, unit: 'MINUTES') }
      steps {
        withCredentials(deployKeys('staging')) {
          sh 'API_URL="$STAGING_API_URL" bash scripts/deploy.sh staging'
        }
        sh 'bash scripts/smoke.sh "$STAGING_API_URL" "$STAGING_SITE_URL"'
      }
    }

    stage('Approve production') {
      when { expression { onMainWithDeploys() } }
      // No agent: waiting for the owner uses no executor.
      steps {
        timeout(time: 24, unit: 'HOURS') {
          input message: "Staging works. Deploy ${env.GIT_COMMIT?.take(7) ?: 'this commit'} to production?",
                ok: 'Deploy to production',
                submitter: env.PRODUCTION_APPROVERS
        }
      }
    }

    stage('Deploy to production') {
      when { expression { onMainWithDeploys() } }
      agent { dockerfile { dir 'jenkins/tools'; args '-e HOME=/tmp' } }
      options { timeout(time: 40, unit: 'MINUTES') }
      steps {
        withCredentials(deployKeys('production')) {
          sh 'bash scripts/deploy.sh production'
          script {
            def healthy = sh(script: 'bash scripts/smoke.sh "$PRODUCTION_API_URL" "$PRODUCTION_SITE_URL"', returnStatus: true) == 0
            if (!healthy) {
              timeout(time: 2, unit: 'HOURS') {
                input message: 'The production smoke test FAILED. Roll back to the previous version?', ok: 'Roll back now',
                      submitter: env.PRODUCTION_APPROVERS
              }
              sh 'bash scripts/rollback.sh'
              error('Production smoke test failed; rolled back to the previous version.')
            }
          }
        }
      }
    }
  }

  post {
    success {
      echo "Done: ${env.BRANCH_NAME} ${env.GIT_COMMIT?.take(7) ?: ''} passed every stage."
    }
    failure {
      script {
        if (env.NOTIFY_EMAIL) {
          mail to: env.NOTIFY_EMAIL,
               subject: "Jenkins FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
               body: "The build failed. Open ${env.BUILD_URL}console to see which stage and why."
        }
      }
    }
  }
}

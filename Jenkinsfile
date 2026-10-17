// Windows Jenkins pipeline (uses `bat`). A Linux/macOS version is in Jenkinsfile.linux.
// Agent needs: Docker Desktop (Linux containers mode), AWS CLI v2, Git.
// Jenkins credentials needed: aws-credentials (type "AWS Credentials").
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    parameters {
        booleanParam(name: 'DEPLOY', defaultValue: false, description: 'Push images to ECR and deploy')
    }

    environment {
        AWS_REGION      = 'ap-southeast-2'
        AWS_ACCOUNT_ID  = '123456789012'                      // <-- change
        ECR_REGISTRY    = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
        BACKEND_REPO    = 'student-result-backend'
        FRONTEND_REPO   = 'student-result-frontend'
        LAMBDA_FUNCTION = 'student-result-api'                // <-- container-image Lambda
        API_BASE_URL    = 'https://ajg34gqivc.execute-api.ap-southeast-2.amazonaws.com'
                IMAGE_TAG       = "${env.BUILD_NUMBER}"
        BUILDX_NO_DEFAULT_ATTESTATIONS = '1'
        APP_DIR         = '.'             // folder containing backend/ and frontend/
        PATH            = "C:\\Users\\aryam\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;${env.PATH}"
    }

    stages {
        stage('Checkout') {
            steps { checkout scm }
        }

        stage('Check tools') {
            steps {
                bat '''
                    docker --version || exit /b 1
                    docker info >nul || exit /b 1
                '''
            }
        }

        stage('Backend tests') {
            steps {
                dir("${APP_DIR}/backend") {
                    bat 'docker run --rm -v "%CD%":/app -w /app python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q" || exit /b 1'
                }
            }
        }

        stage('Build images') {
            steps {
                dir("${APP_DIR}/backend") {
                    // --provenance=false: Lambda rejects OCI image indexes created by buildx attestations.
                    bat 'docker build --platform linux/amd64 -t %BACKEND_REPO%:%IMAGE_TAG% -t %BACKEND_REPO%:latest . || exit /b 1'
                }
                dir("${APP_DIR}/frontend") {
                    bat 'docker build --build-arg API_BASE_URL=%API_BASE_URL% -t %FRONTEND_REPO%:%IMAGE_TAG% -t %FRONTEND_REPO%:latest . || exit /b 1'
                }
            }
        }

        stage('Push to ECR') {
            when { expression { params.DEPLOY } }
            steps {
                withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
                    bat '''
                        aws ecr get-login-password --region %AWS_REGION% | docker login --username AWS --password-stdin %ECR_REGISTRY% || exit /b 1
                        docker tag %BACKEND_REPO%:%IMAGE_TAG%  %ECR_REGISTRY%/%BACKEND_REPO%:%IMAGE_TAG%  || exit /b 1
                        docker tag %BACKEND_REPO%:latest       %ECR_REGISTRY%/%BACKEND_REPO%:latest       || exit /b 1
                        docker tag %FRONTEND_REPO%:%IMAGE_TAG% %ECR_REGISTRY%/%FRONTEND_REPO%:%IMAGE_TAG% || exit /b 1
                        docker tag %FRONTEND_REPO%:latest      %ECR_REGISTRY%/%FRONTEND_REPO%:latest      || exit /b 1
                        docker push %ECR_REGISTRY%/%BACKEND_REPO%:%IMAGE_TAG%  || exit /b 1
                        docker push %ECR_REGISTRY%/%BACKEND_REPO%:latest       || exit /b 1
                        docker push %ECR_REGISTRY%/%FRONTEND_REPO%:%IMAGE_TAG% || exit /b 1
                        docker push %ECR_REGISTRY%/%FRONTEND_REPO%:latest      || exit /b 1
                    '''
                }
            }
        }

        stage('Deploy') {
            when { expression { params.DEPLOY } }
            steps {
                withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-credentials']]) {
                    bat '''
                        aws lambda update-function-code --region %AWS_REGION% --function-name %LAMBDA_FUNCTION% --image-uri %ECR_REGISTRY%/%BACKEND_REPO%:%IMAGE_TAG% || exit /b 1
                        aws lambda wait function-updated --region %AWS_REGION% --function-name %LAMBDA_FUNCTION% || exit /b 1

                        (docker rm -f student-result-frontend) >nul 2>&1 || ver >nul
                        docker run -d --name student-result-frontend --restart unless-stopped -p 80:80 %FRONTEND_REPO%:%IMAGE_TAG% || exit /b 1
                    '''
                }
            }
        }
    }

    post {
        always  { bat returnStatus: true, script: 'docker image prune -f' }
        success { echo "Build #${env.BUILD_NUMBER} succeeded." }
        failure { echo "Build #${env.BUILD_NUMBER} failed." }
    }
}

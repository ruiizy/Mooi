# Local deployment of Mooi outside the platform (e.g. Claude Code in a plain checkout).
# Reuses the development session stack (compose.yml); never touches production files.
# Secrets are generated once into LOCAL_ENV (git-ignored); the host port is assigned by Docker.

COMPOSE_PROJECT_NAME ?= mooi-local-$(shell id -un | tr -cd 'a-z0-9')
LOCAL_ENV ?= .env.local
SECRETS := MOOI_DEVELOPMENT_JWT_SECRET MOOI_DEVELOPMENT_SERVICE_TOKEN MOOI_DEVELOPMENT_SECRETS_KEY

export COMPOSE_PROJECT_NAME
COMPOSE = docker compose $(foreach f,$(wildcard .env) $(LOCAL_ENV),--env-file $(f))

.DEFAULT_GOAL := help
.PHONY: help env up down restart logs ps url clean

help: ## List targets
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-8s %s\n", $$1, $$2}'

env: $(LOCAL_ENV) ## Create local secrets once

$(LOCAL_ENV):
	@umask 077; { \
	  echo '# Local Mooi deployment (make). Never commit.'; \
	  echo 'MOOI_DEVELOPMENT_PUBLIC_ORIGIN=http://localhost'; \
	  echo 'MOOI_DEVELOPMENT_GOOGLE_CLIENT_ID=local-mock'; \
	  echo 'MOOI_DEVELOPMENT_GOOGLE_AUTH_MOCK=true'; \
	  for key in $(SECRETS); do echo "$$key=$$(openssl rand -base64 32)"; done; \
	} > $@
	@echo "Created $@ (add optional MOOI_DEVELOPMENT_* accounts there)"

up: $(LOCAL_ENV) ## Build and start, then align the public origin with the assigned port
	@$(COMPOSE) up -d --build --wait
	@origin="http://localhost:$$($(COMPOSE) port spa-mooi 80 | cut -d: -f2)"; \
	if ! grep -qx "MOOI_DEVELOPMENT_PUBLIC_ORIGIN=$$origin" $(LOCAL_ENV); then \
	  grep -v '^MOOI_DEVELOPMENT_PUBLIC_ORIGIN=' $(LOCAL_ENV) > $(LOCAL_ENV).tmp; \
	  echo "MOOI_DEVELOPMENT_PUBLIC_ORIGIN=$$origin" >> $(LOCAL_ENV).tmp; \
	  mv $(LOCAL_ENV).tmp $(LOCAL_ENV); \
	  $(COMPOSE) up -d --wait; \
	fi; \
	echo "Mooi running at $$origin"

down: ## Stop, keeping data
	@$(COMPOSE) down

restart: down up ## Recreate the stack

logs: ## Follow logs
	@$(COMPOSE) logs -f --tail=200

ps: ## Show services
	@$(COMPOSE) ps

url: ## Print the local address
	@echo "http://localhost:$$($(COMPOSE) port spa-mooi 80 | cut -d: -f2)"

clean: ## Remove containers, volumes and local images
	@$(COMPOSE) down -v --rmi local

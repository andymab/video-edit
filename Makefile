up:
	docker compose up web
up-dev:
	docker compose up --build web

down-up-clear:
	docker compose down -v
	docker compose build --no-cache web

up-prod:
	docker compose up --build web-prod


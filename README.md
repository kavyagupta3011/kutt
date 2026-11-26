# CSE731 Project Setup: Running Kutt Locally

This section explains how to set up and run Kutt (v3.2.6) locally for the CSE731 Software Testing final project. The original Kutt README follows after it.

## 1. Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| WSL 2 (Ubuntu) | any recent | Linux environment on Windows. All commands below run inside WSL |
| Node.js | 20 or newer | Runs the Kutt server |
| npm | comes with Node | Installs dependencies |
| Git | any | Clones the repository |
| PostgreSQL | 14 or newer (local), or a Neon cloud database | Database |
| Mailpit | latest | Local fake mail server for sign-up verification emails |

Install Node.js 20 in WSL (if not already installed):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # should print v20.x or newer
```

## 2. Get the code and install dependencies

```bash
git clone <this-repository-url> kutt_final
cd kutt_final
npm install
```

## 3. Create the `.env` file

Copy the example file and edit it:

```bash
cp .example.env .env
```

Minimum settings (the database settings come in step 4):

```env
PORT=3000
SITE_NAME=Kutt
DEFAULT_DOMAIN=localhost:3000
LINK_LENGTH=6
TRUST_PROXY=true

# Long random string, generate with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<your-random-secret>

DISALLOW_REGISTRATION=false
DISALLOW_ANONYMOUS_LINKS=false
REDIS_ENABLED=false
```

> `.env` holds secrets. Do not commit it. It is listed in `.gitignore`.

## 4. Database setup (choose one option)

### Option A: Local PostgreSQL in WSL (recommended for testing)

A local database needs no internet connection, is fast, and can be reset freely between test runs.

**Install and start PostgreSQL:**

```bash
sudo apt update
sudo apt install -y postgresql
sudo service postgresql start
```

**Set the `postgres` user's password and create the database:**

```bash
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'password';"
sudo -u postgres psql -c "CREATE DATABASE kutt;"
```

**`.env` settings:**

```env
DB_CLIENT=pg
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=kutt
DB_USER=postgres
DB_PASSWORD=password
DB_SSL=false
```

**Forgot the Postgres password?** If `sudo -u postgres psql` itself asks for a password, temporarily allow local logins without one, reset the password, then restore the config:

```bash
PGHBA=$(ls /etc/postgresql/*/main/pg_hba.conf)
sudo cp $PGHBA $PGHBA.bak
sudo sed -i -E 's/^(local\s+all\s+\S+\s+)(md5|scram-sha-256|password|peer)/\1trust/' $PGHBA
sudo service postgresql restart

psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'password';"

sudo cp $PGHBA.bak $PGHBA
sudo service postgresql restart

# check it works (enter: password)
psql -h 127.0.0.1 -U postgres -c "SELECT 1;"
```

### Option B: Neon (cloud PostgreSQL)

1. Create a free project at [neon.tech](https://neon.tech).
2. On the project dashboard, open **Connection Details**. Note the **host** (for example `ep-xxxx-xxxx.us-east-2.aws.neon.tech`), the **database name**, the **user** and the **password**.
3. Set these in `.env`:

```env
DB_CLIENT=pg
DB_HOST=<your-neon-host>
DB_PORT=5432
DB_NAME=<your-neon-database>
DB_USER=<your-neon-user>
DB_PASSWORD=<your-neon-password>
DB_SSL=true
```

**Notes for Neon:**
- `DB_SSL=true` is required, because Neon only accepts encrypted connections.
- If startup fails with `ETIMEDOUT ...:5432`, your network (for example campus Wi-Fi) is blocking outgoing port 5432. Try another network such as a mobile hotspot. Check with: `nc -vz <your-neon-host> 5432`.
- `ENETUNREACH` errors on IPv6 addresses inside WSL can be ignored as long as an IPv4 address connects.
- A cloud database adds network latency and outside failures to test runs, so Option A is preferred for running the test suite.

### Create the tables (both options)

```bash
npm run migrate
```

This creates the `users`, `links`, `visits`, `domains`, `hosts` and `ips` tables. If you see `relation "users" does not exist` when opening the app, this step has not been run against the current database.

## 5. Email setup with Mailpit (needed for sign-up)

Kutt only shows the **Sign up** option when email is enabled, because new accounts must verify their email. Mailpit is a local mail server that catches every email and shows it in a web inbox. Nothing is actually sent.

**Install Mailpit in WSL:**

```bash
sudo bash < <(curl -sL https://raw.githubusercontent.com/axllent/mailpit/develop/install.sh)
```

**Add to `.env`:**

```env
MAIL_ENABLED=true
MAIL_HOST=127.0.0.1
MAIL_PORT=1025
MAIL_SECURE=false
MAIL_FROM=kutt@localhost
```

Leave `MAIL_USER` and `MAIL_PASSWORD` empty. Use `127.0.0.1` rather than `localhost` so Kutt does not try IPv6 (`::1`) first.

## 6. Run the application

Use **two WSL terminals**.

**Terminal 1: Mailpit**

```bash
mailpit
```

**Terminal 2: Kutt**

```bash
sudo service postgresql start   # only for Option A
npm run dev
```

| URL | What |
|---|---|
| http://localhost:3000 | Kutt app |
| http://localhost:8025 | Mailpit inbox (verification and reset emails) |

## 7. First-time use

1. **Create the admin:** on a fresh database, the first visit to http://localhost:3000 shows a **create admin** page. The first account created there gets the `ADMIN` role.
2. **Sign up a normal user:** log out, choose **Log in / Sign up**, enter an email and password (8–64 characters) and click **Sign up**.
3. **Verify the email:** open http://localhost:8025 and click the verification link in the email.
   - **Known issue:** Kutt always builds email links with `https://`, but the local server only serves plain `http`, so the browser shows `ERR_SSL_PROTOCOL_ERROR`. Change `https://` to `http://` in the address bar. If Chrome keeps forcing https on localhost, open `chrome://net-internals/#hsts` and delete the domain security policy for `localhost`.
4. **Roles:** only the first account (admin) sees the **Admin** page. Accounts made through sign-up are normal users. Admins can also create users from **Admin → Users → Create user**.

## 8. Daily start checklist

```bash
sudo service postgresql start   # Option A only
mailpit                         # terminal 1
npm run dev                     # terminal 2
```

## 9. Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| No **Sign up** button | `MAIL_ENABLED=false` | Set up Mailpit (step 5) and restart Kutt |
| `connect ECONNREFUSED 127.0.0.1:1025` / `::1:1025` | Mailpit not running, or running on the Windows side | Run `mailpit` inside WSL. Use `MAIL_HOST=127.0.0.1` |
| `ERR_SSL_PROTOCOL_ERROR` on the verify link | Email link uses `https://` | Change it to `http://` (see step 7) |
| `password authentication failed for user "postgres"` | Wrong or forgotten DB password | Reset it (step 4, Option A) |
| `relation "users" does not exist` | Tables not created | `npm run migrate` |
| `ETIMEDOUT <ip>:5432` | Cloud DB unreachable from this network | Use another network, or switch to Option A |
| Repeated login/sign-up attempts rejected | Rate limit: 5 requests per minute on auth routes | Wait one minute |

---

# Original Kutt README

<p align="center"><a href="https://kutt.to" title="kutt.to"><img src="https://raw.githubusercontent.com/thedevs-network/kutt/9d1c873897c3f5b9a1bd0c74dc5d23f2ed01f2ec/static/images/logo-github.png" alt="Kutt.to"></a></p>

# Kutt.to

**Kutt** is a modern URL shortener with support for custom domains. Create and edit links, view statistics, manage users, and more.

[https://kutt.to](https://kutt.to)

> [!WARNING]
> **[kutt.it](https://kutt.it) is NOT OWNED BY US.** It could be a phishing site. We had the domain but it has been deactivated by the Italian TLD registrar due to the lack of identification documents, and now it's owned by someone else.


>  Please use [kutt.to](https://kutt.to), all the previous and the future links work with this domain as well.


[![docker-build-release](https://github.com/thedevs-network/kutt/actions/workflows/docker-build-release.yaml/badge.svg)](https://github.com/thedevs-network/kutt/actions/workflows/docker-build-release.yaml)
[![Uptime Status](https://uptime.betterstack.com/status-badges/v2/monitor/1ogaa.svg)](https://status.kutt.to)
[![Contributions](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](https://github.com/thedevs-network/kutt/#contributing)
[![GitHub license](https://img.shields.io/github/license/thedevs-network/kutt.svg)](https://github.com/thedevs-network/kutt/blob/develop/LICENSE)

## Table of contents

- [Key features](#key-features)
- [Donations and sponsors](#donations-and-sponsors)
- [Setup](#setup)
- [Docker](#docker)
- [API](#api)
- [Configuration](#configuration)
- [Themes and customizations](#themes-and-customizations)
- [Browser extensions](#browser-extensions)
- [Videos](#videos)
- [Integrations](#integrations)
- [Contributing](#contributing)

## Key features

- Created with self-host in mind:
  - Zero configuration needed
  - Easy setup with no build step
  - Supporting various databases (SQLite, Postgres, MySQL)
  - Ability to disable registration and anonymous links
  - OpenID Connect (OIDC) login
- Custom domain support
- Set custom URLs, password, description, and expiration time for links
- View, edit, delete and manage your links
- Private statistics for shortened URLs
- Admin page to manage users and links
- Customizability and themes
- RESTful API

## Donations and sponsors

Support the development of Kutt by making a donation or becoming an sponsor.

[Donate or sponsor →](https://btcpay.kutt.to/apps/L9Gc7PrnLykeRHkhsH2jHivBeEh/crowdfund)

## Setup

The only prerequisite is [Node.js](https://nodejs.org/) (version 20 or above). The default database is SQLite. You can optionally install Postgres or MySQL/MariaDB for the database or Redis for the cache. 

When you first start the app, you're prompted to create an admin account.

1. Clone this repository or [download the latest zip](https://github.com/thedevs-network/kutt/releases)
2. Install dependencies: `npm install`
3. Initialize database: `npm run migrate`
5. Start the app for development `npm run dev` or production `npm start`

## Docker

Make sure Docker is installed, then you can start the app from the root directory:

```sh
docker compose up
```

Various docker-compose configurations are available. Use `docker compose -f <file_name> up` to start the one you want:

- [`docker-compose.yml`](./docker-compose.yml): Default Kutt setup. Uses SQLite for the database.
- [`docker-compose.sqlite-redis.yml`](./docker-compose.sqlite-redis.yml): Starts Kutt with SQLite and Redis.
  - Required environment variable: `REDIS_ENABLED`
- [`docker-compose.postgres.yml`](./docker-compose.postgres.yml): Starts Kutt with Postgres and Redis.
  - Required environment variables: `REDIS_ENABLED`, `DB_PASSWORD`, `DB_NAME`, `DB_USER`
- [`docker-compose.mariadb.yml`](./docker-compose.mariadb.yml): Starts Kutt with MariaDB and Redis.
  - Required environment variables: `REDIS_ENABLED`, `DB_PASSWORD`, `DB_NAME`, `DB_USER`, `DB_PORT`

Official Kutt Docker image is available on [Docker Hub](https://hub.docker.com/r/kutt/kutt).

## API

[View API documentation →](https://docs.kutt.to)

## Configuration

The app is configured via environment variables. You can pass environment variables directly or create a `.env` file. View [`.example.env`](./.example.env) file for the list of configurations.

All variables are optional except `JWT_SECRET` which is required on production. 

You can use files for each of the variables by appending `_FILE` to the name of the variable. Example: `JWT_SECRET_FILE=/path/to/secret_file`.

| Variable | Description | Default | Example |
| -------- | ----------- | ------- | ------- |
| `JWT_SECRET` | This is used to sign authentication tokens. Use a **long** **random** string. | - | - |
| `PORT` |  The port to start the app on | `3000` | `8888` |
| `SITE_NAME` |  Name of the website | `Kutt` | `Your Site` |
| `DEFAULT_DOMAIN` |  The domain address that this app runs on | `localhost:3000` | `yoursite.com` |
| `LINK_LENGTH` | The length of of shortened address | `6` | `5` |
| `LINK_CUSTOM_ALPHABET` | Alphabet used to generate custom addresses. Default value omits o, O, 0, i, I, l, 1, and j to avoid confusion when reading the URL. | (abcd..789) | `abcABC^&*()@` |
| `DISALLOW_REGISTRATION` | Disable registration. Note that if `MAIL_ENABLED` is set to false, then the registration would still be disabled since it relies on emails to sign up users. | `true` | `false` |
| `DISALLOW_LOGIN_FORM` | Disable login with email and password. Only makes sense if OIDC is enabled. | `false` | `true` |
| `DISALLOW_ANONYMOUS_LINKS` | Disable anonymous link creation | `true` | `false` |
| `TRUST_PROXY` | If the app is running behind a proxy server like NGINX or Cloudflare and that it should get the IP address from that proxy server. If you're not using a proxy server then set this to false, otherwise users can override their IP address. | `true` | `false` |
| `DB_CLIENT` |  Which database client to use. Supported clients: `pg` or `pg-native` for Postgres, `mysql2` for MySQL or MariaDB, `sqlite3` and `better-sqlite3` for SQLite. NOTE: `pg-native` and `sqlite3` are not installed by default, use `npm` to install them before use. | `better-sqlite3` | `pg` |
| `DB_FILENAME` |  File path for the SQLite database. Only if you use SQLite. | `db/data` | `/var/lib/data` |
| `DB_HOST` | Database connection host. Only if you use Postgres or MySQL. | `localhost` | `your-db-host.com` |
| `DB_PORT` | Database port. Only if you use Postgres or MySQL. | `5432` (Postgres) | `3306` (MySQL) |
| `DB_NAME` | Database name. Only if you use Postgres or MySQL. | `kutt` | `mydb` |
| `DB_USER` | Database user. Only if you use Postgres or MySQL. | `postgres` | `myuser` |
| `DB_PASSWORD` | Database password. Only if you use Postgres or MySQL. | - | `mypassword` |
| `DB_SSL` | Whether use SSL for the database connection. Only if you use Postgres or MySQL. | `false` | `true` |
| `DB_POOL_MIN` | Minimum number of database connection pools. Only if you use Postgres or MySQL. | `0` | `2` |
| `DB_POOL_MAX` | Maximum number of database connection pools. Only if you use Postgres or MySQL. | `10` | `5` |
| `REDIS_ENABLED` | Whether to use Redis for cache | `false` | `true` |
| `REDIS_HOST` | Redis connection host | `127.0.0.1` | `your-redis-host.com` |
| `REDIS_PORT` | Redis port | `6379` | `6379` |
| `REDIS_PASSWORD` | Redis password | - | `mypassword` |
| `REDIS_DB` | Redis database number, between 0 and 15. | `0` | `1` |
| `SERVER_IP_ADDRESS` | The IP address shown to the user on the setting's page. It's only for display purposes and has no other use. | - | `1.2.3.4` |
| `SERVER_CNAME_ADDRESS` | The subdomain shown to the user on the setting's page. It's only for display purposes and has no other use. | - | `custom.yoursite.com` |
| `CUSTOM_DOMAIN_USE_HTTPS` | Use https for links with custom domain. It's on you to generate SSL certificates for those domains manually—at least on this version for now. | `false` | `true` |
| `ENABLE_RATE_LIMIT` | Enable rate limiting for some API routes. If Redis is enabled uses Redis, otherwise, uses memory. | `false` | `true` |
| `MAIL_ENABLED` | Enable emails, which are used for signup, verifying or changing email address, resetting password, and sending reports. If is disabled, all these functionalities will be disabled too. | `false` | `true` | 
| `MAIL_HOST` | Email server host | - | `your-mail-server.com` |
| `MAIL_PORT` | Email server port | `587` | `465` (SSL) | 
| `MAIL_USER` | Email server user | - | `myuser` | 
| `MAIL_PASSWORD` | Email server password for the user | - | `mypassword` | 
| `MAIL_FROM` | Email address to send the user from | - | `example@yoursite.com` | 
| `MAIL_SECURE` | Whether use SSL for the email server connection | `false` | `true` | 
| `OIDC_ENABLED` | Enable OpenID Connect | `false` | `true` | 
| `OIDC_ISSUER` | OIDC issuer URL | - | `https://example.com/some/path` | 
| `OIDC_POMPT` | OIDC prompt | - | `login` | 
| `OIDC_CLIENT_ID` | OIDC client id | - | `example-app` | 
| `OIDC_CLIENT_SECRET` | OIDC client secret | - | `some-secret` | 
| `OIDC_SCOPE` | OIDC Scope | `openid profile email` | `openid email` | 
| `OIDC_EMAIL_CLAIM` | Name of the field to get user's email from | `email` | `userEmail` | 
| `OIDC_BUTTON_TEXT` | OIDC login button text | `Log in with OIDC` | `Log in via Example` | 
| `REPORT_EMAIL` | The email address that will receive submitted reports | - | `example@yoursite.com` | 
| `CONTACT_EMAIL` | The support email address to show on the app | - | `example@yoursite.com` | 

## Themes and customizations

You can add styles, change images, or render custom HTML. Place your content inside the [`/custom`](./custom) folder according to below instructions.

#### How it works:

The structure of the custom folder is like this:

```
custom/
├─ css/
│  ├─ custom1.css
│  ├─ custom2.css
│  ├─ ...
├─ images/
│  ├─ logo.png
│  ├─ favicon.ico
│  ├─ ...
├─ views/
│  ├─ partials/
│  │  ├─ footer.hbs
│  ├─ 404.hbs
│  ├─ ...
```

- **css**: Put your CSS style files here. ([View example →](https://github.com/thedevs-network/kutt-customizations/tree/main/themes/crimson/css))
  - You can put as many style files as you want: `custom1.css`, `custom2.css`, etc.
  - If you name your style file `styles.css`, it will replace Kutt's original `styles.css` file.
  - Each file will be accessible by `<your-site.com>/css/<file>.css`
- **images**: Put your images here. ([View example →](https://github.com/thedevs-network/kutt-customizations/tree/main/themes/crimson/images))
  - Name them just like the files inside the [`/static/images/`](./static/images) folder to replace Kutt's original images.
  - Each image will be accessible by `<your-site.com>/images/<image>.<image-format>`
- **views**: Custom HTML templates to render. ([View example →](https://github.com/thedevs-network/kutt-customizations/tree/main/themes/crimson/views))
  - It should follow the same file naming and folder structure as [`/server/views`](./server/views)
  - Although we try to keep the original file names unchanged, be aware that new changes on Kutt might break your custom views.
 
#### Example theme: Crimson

This is an example and official theme. Crimson includes custom styles, images, and views.

[Get Crimson theme →](https://github.com/thedevs-network/kutt-customizations/tree/main/themes/crimson)

[View list of themes and customizations →](https://github.com/thedevs-network/kutt-customizations)


| Homepage | Admin page | Login/signup |
| -------- | ---------- | ------------ |
| ![crimson-homepage](https://github.com/user-attachments/assets/b74fab78-5e80-4f57-8425-f0cc73e9c68d) | ![crimson-admin](https://github.com/user-attachments/assets/a75d2430-8074-4ce4-93ec-d8bdfd75d917) | ![crimson-login-signup ](https://github.com/user-attachments/assets/b915eb77-3d66-4407-8e5d-b556f80ff453)

#### Usage with Docker:

If you're building the image locally, then the `/custom` folder should already be included in your app.

If you're pulling the official image, make sure `/kutt/custom` volume is mounted or you have access to it. [View Docker compose example →](https://github.com/thedevs-network/kutt/blob/main/docker-compose.yml#L7)

Then, move your files to that volume. You can do it with this Docker command:

```sh
docker cp <path-to-custom-folder> <kutt-container-name>:/kutt
```

For example:

```sh
docker cp custom kutt-server-1:/kutt
```

Make sure to restart the kutt server container after copying files or making changes.

## Browser extensions

Download Kutt's extension for web browsers via below links.

- [Chrome](https://chrome.google.com/webstore/detail/kutt/pklakpjfiegjacoppcodencchehlfnpd)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/kutt/)

## Videos

**Official videos**

- [Next.js to htmx – A Real World Example](https://www.youtube.com/watch?v=8RL4NvYZDT4)

## Integrations

- **ShareX** – You can use Kutt as your default URL shortener in [ShareX](https://getsharex.com/). If you host your custom instance of Kutt, refer to [ShareX wiki](https://github.com/thedevs-network/kutt/wiki/ShareX) on how to setup.
- **Alfred workflow** – Download Kutt's official workflow for [Alfred](https://www.alfredapp.com/) app from [alfred-kutt](https://github.com/thedevs-network/alfred-kutt) repository.
- **iOS shortcut** – [Kutt shortcut](https://www.icloud.com/shortcuts/a829856aea2c420e97c53437e68b752b) for your apple device which works from the iOS sharing context menu or on standalone mode. A courtesy of [@caneeeeee](https://github.com/caneeeeee).

**Third-party packages**


| Language        | Link                                                                              | Description                                          |
| --------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| C# (.NET)       | [KuttSharp](https://github.com/0xaryan/KuttSharp)                                 | .NET package for Kutt.to url shortener               |
| C# (.NET)       | [Kutt.NET](https://github.com/AlphaNecron/Kutt.NET)                               | C# API Wrapper for Kutt                              |
| Python          | [kutt-cli](https://github.com/RealAmirali/kutt-cli)                               | Command-line client for Kutt written in Python       |
| Ruby            | [kutt.rb](https://github.com/RealAmirali/kutt.rb)                                 | Kutt library written in Ruby                         |
| Rust            | [urlshortener](https://github.com/vityafx/urlshortener-rs)                        | URL shortener library written in Rust                |
| Rust            | [kutt-rs](https://github.com/robatipoor/kutt-rs)                                  | Command line tool written in Rust                    |
| Node.js         | [node-kutt](https://github.com/ardalanamini/node-kutt)                            | Node.js client for Kutt.to url shortener             |
| JavaScript      | [kutt-vscode](https://github.com/mehrad77/kutt-vscode)                            | Visual Studio Code extension for Kutt                |
| Java            | [kutt-desktop](https://github.com/cipher812/kutt-desktop)                         | A Cross platform Java desktop application for Kutt   |
| Go              | [kutt-go](https://github.com/raahii/kutt-go)                                      | Go client for Kutt.to url shortener                  |
| BASH            | [GitHub Gist](https://gist.github.com/hashworks/6d6e4eae8984a5018f7692a796d570b4) | Simple BASH function to access the API               |
| BASH            | [url-shortener](https://git.tim-peters.org/Tim/url-shortener)                     | Simple BASH script with GUI                          |
| Kubernetes/Helm | [ArtifactHub](https://artifacthub.io/packages/helm/christianhuth/kutt)            | A Helm Chart to install Kutt on a Kubernetes cluster |

## Contributing

Pull requests are welcome. Open a discussion for feedback, requesting features, or discussing ideas.

Special thanks to [Thomas](https://github.com/trgwii) and [Muthu](https://github.com/MKRhere). Logo design by [Muthu](https://github.com/MKRhere).


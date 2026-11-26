# Setup notes (Kutt - testing project)

This is our forked copy of Kutt (https://github.com/thedevs-network/kutt) that we're testing.
Run it locally like this.

We use Postgres (Neon) instead of the default SQLite, because SQLite's binary gets
blocked by Windows app control on college laptops. The pg driver is plain JS so it works.

What you need: Node 20+, Git, a free Neon account (neon.tech), and Mailpit for the signup emails
(https://github.com/axllent/mailpit/releases).

1. Clone + install
   git clone https://github.com/kavyagupta3011/kutt.git
   cd kutt
   npm install

2. Make your own Neon project (Postgres only) and copy its connection string.

3. Make a .env file in the project root. Copy this and put your own Neon values in.
   Don't commit it (it's already gitignored).

   PORT=3000
   SITE_NAME=Kutt
   DEFAULT_DOMAIN=localhost:3000
   JWT_SECRET=put any long random string here

   DB_CLIENT=pg
   DB_HOST=your-host.neon.tech
   DB_PORT=5432
   DB_NAME=neondb
   DB_USER=your_user
   DB_PASSWORD=your_password
   DB_SSL=true

   DISALLOW_REGISTRATION=false
   DISALLOW_ANONYMOUS_LINKS=false

   MAIL_ENABLED=true
   MAIL_HOST=localhost
   MAIL_PORT=1025
   MAIL_SECURE=false
   MAIL_FROM=Kutt <test@localhost>

4. Create the tables:  npm run migrate
   (Neon sleeps when idle so the first run takes a few seconds.)

5. Start Mailpit in its own terminal:  .\mailpit.exe
   Inbox is at http://localhost:8025

6. Start the app:  npm run dev
   Then open http://localhost:3000

7. First account you make becomes the admin. Then sign up a normal user -
   the verify email shows up in Mailpit. The verify link opens as https, just
   change it to http in the address bar (local runs on http).

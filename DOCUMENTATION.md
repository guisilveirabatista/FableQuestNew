# Running tests

go test ./...
go test -v ./... // Detailed logs

# Building the project

 To build the project, you only need to build the Go server, as the frontend browser client has no
  build step (no JavaScript package installation or bundling is required).

  Here is how you build the server:

  ### 1. Standard Build

  Navigate to the  server  directory and build the executable:

    cd server
    go build -o server .
    
  This produces a  server  binary in the current directory.
  ──────
  ### 2. Build with PostgreSQL Support (Optional)

  If you want to use a PostgreSQL database instead of the default file-based JSON database, build
  with the  postgres  build tag:

    cd server
    go build -tags postgres -o server .
    ──────
  ### 3. How to Run the Built Server

  Once built, you can run the executable:

    # Run with default JSON database:
    ./server

    # Or with custom options (e.g. specifying admins):
    ./server -admins admin,gm

  Then, open http://localhost:8080 in your browser.


# Adding Items to the Shop

  The game uses a secure client-server architecture, which means shops have to be updated in two places (one for the visual interface, and
  one for backend anti-cheat validation):

  1. Frontend (Visuals): You need to add the item's internal ID to the  SHOPS  object inside  sim.js . You'll find it around line 571 under
  stock: ['sword1', 'sword2', ...]  for the Blacksmith.
  2. Backend (Security): You need to add the same internal ID to the  shops  map in  server/items.go  (around line 110). This ensures the
  server actually authorizes players to buy the item with their gold.

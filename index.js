const httpServer = require("http").createServer();
const uuid = require("uuid");
const ShortUniqueId = require("short-unique-id");

const io = require("socket.io")(httpServer, {
  cors: {
    origins: ["http://localhost:8080"],
  },
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 5;
const rooms = {};

const { InMemorySessionStore } = require("./sessionStore");
const sessionStore = new InMemorySessionStore();

const ROLES = ["Imposteur", "Droide", "Mage"];

const generateRoomCode = () => {
  const generator = new ShortUniqueId({ dictionary: "hex", length: 6 });
  let code = generator();

  while (Object.values(rooms).some((room) => room.code === code)) {
    code = generator();
  }

  return code;
};

const findRoomBySocketId = (socketId) =>
  Object.values(rooms).find((room) =>
    room.players.some((player) => player.socketId === socketId)
  );

const findRoomByCode = (roomCode) =>
  Object.values(rooms).find((room) => room.code === roomCode);

const gameState = (room) => ({
  id: room.id,
  code: room.code,
  owner: room.owner,
  state: room.state,
  players: room.players.map((player) => ({
    socketId: player.socketId,
    pseudo: player.pseudo,
    role: room.state === 1 ? player.role : undefined,
  })),
});

const saveSocketSession = (socket, connected) => {
  sessionStore.saveSession(socket.sessionID, {
    socketId: socket.id,
    roomId: socket.roomId,
    username: socket.username,
    connected,
  });
};

const joinRoom = (pseudo, socket, room) => {
  const existingPlayer = room.players.find(
    (player) => player.socketId === socket.id
  );

  if (existingPlayer) {
    existingPlayer.pseudo = pseudo;
  } else {
    room.players.push({ socketId: socket.id, pseudo, role: null });
  }

  socket.join(room.id);
  socket.roomId = room.id;
  saveSocketSession(socket, true);

  io.to(room.id).emit("updateRoom", gameState(room));
};

const leaveRoom = (socket) => {
  const room = findRoomBySocketId(socket.id);

  if (!room) {
    socket.emit("leaveRoom");
    return;
  }

  socket.leave(room.id);
  room.players = room.players.filter((player) => player.socketId !== socket.id);
  socket.roomId = null;
  socket.emit("leaveRoom");

  if (room.players.length === 0) {
    delete rooms[room.id];
    return;
  }

  if (room.owner === socket.id) {
    room.owner = room.players[0].socketId;
  }

  io.to(room.id).emit("updateRoom", gameState(room));
};

io.use(async (socket, next) => {
  const sessionID = socket.handshake.auth.sessionID;
  if (sessionID) {
    const session = await sessionStore.findSession(sessionID);
    if (session) {
      socket.sessionID = sessionID;
      socket.roomId = session.roomId;
      socket.username = session.username;
      return next();
    }
    socket.emit("session_expired");
    return next();
  }

  const username = socket.handshake.auth.username;
  if (!username) {
    return next(new Error("invalid username"));
  }

  socket.sessionID = uuid.v1();
  socket.username = username;
  next();
});

io.on("connection", (socket) => {
  console.log("player connected " + socket.id);

  saveSocketSession(socket, true);

  socket.emit("session", {
    sessionID: socket.sessionID,
    id: socket.id,
  });

  if (socket.roomId && rooms[socket.roomId]) {
    const room = rooms[socket.roomId];

    if (!room.players.some((player) => player.socketId === socket.id)) {
      room.players.push({
        socketId: socket.id,
        pseudo: socket.username,
        role: null,
      });
    }

    socket.join(room.id);
    io.to(room.id).emit("updateRoom", gameState(room));
  }

  socket.on("startGame", () => {
    const room = rooms[socket.roomId];
    if (!room || socket.id !== room.owner) {
      return;
    }

    const playerCount = room.players.length;
    if (playerCount < 2) {
      socket.emit(
        "startGameFailed",
        `Impossible de créer la partie: seulement ${playerCount} joueur(s).`
      );
      return;
    }

    room.state = 1;
    room.started_at = Date.now();

    room.players = room.players.map((player) => ({
      ...player,
      role: ROLES[Math.floor(Math.random() * ROLES.length)],
    }));

    io.to(room.id).emit("startGame", gameState(room));
  });

  socket.on("createRoom", (pseudo) => {
    const roomAlreadyJoined = findRoomBySocketId(socket.id);
    if (roomAlreadyJoined) {
      socket.emit("joinRoomFailed", "player already in a room");
      return;
    }

    const room = {
      id: uuid.v1(),
      code: generateRoomCode(),
      players: [],
      state: 0,
      owner: socket.id,
      create_at: Date.now(),
      started_at: null,
    };

    rooms[room.id] = room;
    joinRoom(pseudo, socket, room);

    socket.emit("createRoomSuccess", gameState(room));
  });

  socket.on("joinRoom", ({ pseudo, roomCode }) => {
    const roomAlreadyJoined = findRoomBySocketId(socket.id);
    if (roomAlreadyJoined) {
      socket.emit("joinRoomFailed", "player already in a room");
      return;
    }

    const room = findRoomByCode(roomCode);
    if (!room) {
      socket.emit("joinRoomFailed", "room code invalid");
      return;
    }

    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      socket.emit("joinRoomFailed", "room is full");
      return;
    }

    joinRoom(pseudo, socket, room);
  });

  socket.on("leaveRoom", () => {
    leaveRoom(socket);
  });

  socket.on("disconnect", () => {
    saveSocketSession(socket, false);
    leaveRoom(socket);
    console.log("user disconnected");
  });
});

httpServer.listen(PORT, () => {
  console.log(`server listening on localhost:${PORT}`);
});

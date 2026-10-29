try {
  const status = rs.status();
  if (status.ok && status.members.some((member) => member.stateStr === 'PRIMARY')) {
    quit(0);
  }
  quit(1);
} catch (error) {
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
  quit(1);
}

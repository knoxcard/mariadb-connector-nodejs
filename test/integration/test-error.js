"use strict";

const base = require("../base.js");
const assert = require("chai").assert;

describe("Error", () => {
  it("query error", function(done) {
    shareConn.query("wrong query", err => {
      assert.isTrue(err != null);
      assert.isTrue(err.message.includes("You have an error in your SQL syntax"));
      assert.isTrue(err.message.includes("sql: wrong query - parameters:[]"));
      assert.equal(err.errno, 1064);
      assert.equal(err.sqlState, 42000);
      done();
    });
  });

  it("execute error", function(done) {
    shareConn.execute("wrong query", err => {
      assert.isTrue(err != null);
      assert.isTrue(err.message.includes("You have an error in your SQL syntax"));
      assert.isTrue(err.message.includes("sql: wrong query - parameters:[]"));
      assert.equal(err.errno, 1064);
      assert.equal(err.sqlState, 42000);
      done();
    });
  });

  it("query after connection ended", function(done) {
    const conn = base.createConnection();
    conn.connect(() => {
      conn.end(() => {
        conn.query("DO 1", err => {
          assert.isTrue(err != null);
          assert.isTrue(err.message.includes("Cannot execute new commands: connection closed"));
          assert.isTrue(err.message.includes("sql: DO 1 - parameters:[]"));
          assert.isTrue(err.fatal);
          conn.execute("DO 1", err => {
            assert.isTrue(err != null);
            assert.isTrue(err.message.includes("Cannot execute new commands: connection closed"));
            assert.isTrue(err.message.includes("sql: DO 1 - parameters:[]"));
            assert.isTrue(err.fatal);
            done();
          });
        });
      });
    });
  });

  it("transaction after connection ended", function(done) {
    const conn = base.createConnection();
    conn.connect(() => {
      conn.end(() => {
        conn.beginTransaction(err => {
          assert.isTrue(err != null);
          assert.isTrue(err.message.includes("Cannot execute new commands: connection closed"));
          assert.isTrue(err.message.includes("sql: START TRANSACTION - parameters:[]"));
          assert.isTrue(err.fatal);
          done();
        });
      });
    });
  });

  it("server close connection without warning", function(done) {
    this.timeout(20000);
    const conn = base.createConnection();
    conn.on("error", err => {
      assert.isTrue(err.message.includes("socket has unexpectedly been closed"));
    });
    conn.connect(function(err) {
      if (err) {
        done(err);
      } else {
        conn.query("set @@wait_timeout = 1");
        setTimeout(function() {
          conn.query("SELECT 2", function(err, rows) {
            assert.isTrue(err.message.includes("Cannot execute new commands: connection closed"));
            done();
          });
        }, 2000);
      }
    });
  });

  it("server close connection - no connection error event", function(done) {
    this.timeout(20000);

    // Remove Mocha's error listener
    const originalException = process.listeners("uncaughtException").pop();
    process.removeListener("uncaughtException", originalException);

    // Add your own error listener to check for unhandled exceptions
    process.once("uncaughtException", function(err) {
      const recordedError = err;

      process.nextTick(function() {
        process.listeners("uncaughtException").push(originalException);
        assert.isTrue(recordedError.message.includes("socket has unexpectedly been closed"));
        done();
      });
    });

    const conn = base.createConnection();
    conn.connect(function(err) {
      if (err) {
        done(err);
      } else {
        conn.query("set @@wait_timeout = 1");
        setTimeout(function() {
          conn.query("SELECT 2", function(err, rows) {
            assert.isTrue(err.message.includes("Cannot execute new commands: connection closed"));
          });
        }, 2000);
      }
    });
  });

  it("server close connection during query", function(done) {
    this.timeout(20000);
    const conn = base.createConnection();
    conn.on("error", err => {});
    conn.connect(function() {
      conn.query("SELECT SLEEP(5)", function(err) {
        assert.isTrue(err.message.includes("socket has unexpectedly been closed"));
        done();
      });
      setTimeout(function() {
        shareConn.query("KILL " + conn.threadId);
      }, 20);
    });
  });

  it("end connection query error", function(done) {
    const conn = base.createConnection();
    conn.connect(() => {
      conn.query(
        "select * from information_schema.columns as c1,  information_schema.tables, information_schema.tables as t2",
        err => {
          if (err) {
            assert.ok(err.message.includes("close forced"));
            done();
          } else {
            done(new Error("Must have thrown an exception !"));
          }
        }
      );
      setTimeout(conn._socket.destroy.bind(conn._socket, new Error("close forced")), 5);
    });
  });

  it("query parameters logged in error", function(done) {
    const handleResult = function(err) {
      assert.equal(1146, err.errno);
      assert.equal("42S02", err.sqlState);
      assert.isFalse(err.fatal);
      assert.isTrue(
        err.message.includes(
          "sql: INSERT INTO falseTable(t1, t2, t3, t4, t5) values (?, ?, ?, ?, ?)  - parameters:[1,0x01ff,'hh','01/01/2001 00:00:00.000',null]"
        )
      );
    };

    shareConn.query(
      "INSERT INTO falseTable(t1, t2, t3, t4, t5) values (?, ?, ?, ?, ?) ",
      [1, Buffer.from([0x01, 0xff]), "hh", new Date(2001, 0, 1, 0, 0, 0), null],
      handleResult
    );
    shareConn.execute(
      "INSERT INTO falseTable(t1, t2, t3, t4, t5) values (?, ?, ?, ?, ?) ",
      [1, Buffer.from([0x01, 0xff]), "hh", new Date(2001, 0, 1, 0, 0, 0), null],
      handleResult
    );
    shareConn.execute("SELECT 1", (err, rows) => {
      assert.deepEqual(rows, [{ "1": 1 }]);
      done();
    });
  });

  it("query undefined parameter", function(done) {
    const handleResult = function(err) {
      assert.equal(err.errno, 1210);
      assert.equal(err.sqlState, "HY000");
      assert.isFalse(err.fatal);
      assert.ok(
        err.message.includes(
          "Parameter at position 2 is undefined\n" +
            "sql: INSERT INTO undefinedParameter values (?, ?, ?) - parameters:[1,undefined,3]"
        )
      );
    };

    shareConn.query("CREATE TEMPORARY TABLE undefinedParameter (id int, id2 int, id3 int)");
    shareConn.query(
      "INSERT INTO undefinedParameter values (?, ?, ?)",
      [1, undefined, 3],
      handleResult
    );
    shareConn.execute(
      "INSERT INTO undefinedParameter values (?, ?, ?)",
      [1, undefined, 3],
      handleResult
    );
    shareConn.query("SELECT 1", (err, rows) => {
      assert.deepEqual(rows, [{ "1": 1 }]);
      done();
    });
  });

  it("query missing parameter", function(done) {
    const handleResult = function(err) {
      assert.equal(err.errno, 1210);
      assert.equal(err.sqlState, "HY000");
      assert.isFalse(err.fatal);
      assert.ok(
        err.message.includes(
          "Parameter at position 3 is not set\n" +
            "sql: INSERT INTO execute_missing_parameter values (?, ?, ?) - parameters:[1,3]"
        )
      );
    };
    shareConn.query("CREATE TEMPORARY TABLE execute_missing_parameter (id int, id2 int, id3 int)");
    shareConn.query("INSERT INTO execute_missing_parameter values (?, ?, ?)", [1, 3], handleResult);
    shareConn.execute(
      "INSERT INTO execute_missing_parameter values (?, ?, ?)",
      [1, 3],
      handleResult
    );
    shareConn.query("SELECT 1", (err, rows) => {
      assert.deepEqual(rows, [{ "1": 1 }]);
      done();
    });
  });

  it("query no parameter", function(done) {
    const handleResult = function(err) {
      assert.equal(err.errno, 1210);
      assert.equal(err.sqlState, "HY000");
      assert.isFalse(err.fatal);
      assert.ok(
        err.message.includes(
          "Parameter at position 1 is not set\n" +
            "sql: INSERT INTO execute_no_parameter values (?, ?, ?) - parameters:[]"
        )
      );
    };
    shareConn.query("CREATE TEMPORARY TABLE execute_no_parameter (id int, id2 int, id3 int)");
    shareConn.query("INSERT INTO execute_no_parameter values (?, ?, ?)", [], handleResult);
    shareConn.execute("INSERT INTO execute_no_parameter values (?, ?, ?)", [], handleResult);
    shareConn.query("SELECT 1", (err, rows) => {
      assert.deepEqual(rows, [{ "1": 1 }]);
      done();
    });
  });

  it("query to much parameter", function(done) {
    shareConn.query("CREATE TEMPORARY TABLE to_much_parameters (id int, id2 int, id3 int)");
    shareConn.query("INSERT INTO to_much_parameters values (?, ?, ?) ", [1, 2, 3, 4], function(
      err
    ) {
      if (err) {
        done(err);
      } else {
        shareConn.execute(
          "INSERT INTO to_much_parameters values (?, ?, ?) ",
          [1, 2, 3, 4],
          function(err) {
            if (err) {
              done(err);
            } else {
              done();
            }
          }
        );
      }
    });
  });

  it("fetching error", function(done) {
    let hasThrownError = false;
    shareConn
      .query("SELECT * FROM unknownTable")
      .on("error", function(err) {
        assert.ok(
          err.message.includes("Table") &&
            err.message.includes("doesn't exist") &&
            err.message.includes("sql: SELECT * FROM unknownTable")
        );
        hasThrownError = true;
      })
      .on("fields", function(fields) {
        done(new Error("must have not return fields"));
      })
      .on("result", function(row) {
        done(new Error("must have not return results"));
      })
      .on("end", function() {
        assert.ok(hasThrownError);
        done();
      });
  });
});

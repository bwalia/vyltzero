#![allow(deprecated)]
//! CLI integration tests for vyltzero-cli.
//!
//! These tests verify that the CLI binary starts correctly, parses arguments,
//! and produces expected output for help and error cases. They do NOT require
//! a running VyltZero server.

use assert_cmd::Command;
use predicates::prelude::*;

fn cli() -> Command {
    Command::cargo_bin("vyltzero").expect("binary should exist")
}

#[test]
fn shows_help_with_no_args() {
    cli()
        .assert()
        .failure()
        .stderr(predicate::str::contains("VyltZero CLI"));
}

#[test]
fn shows_version() {
    cli()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("vyltzero"));
}

#[test]
fn secret_get_requires_path() {
    cli().args(["secret", "get"]).assert().failure();
}

#[test]
fn transit_encrypt_requires_args() {
    cli().args(["transit", "encrypt"]).assert().failure();
}

#[test]
fn completion_generates_bash() {
    cli()
        .args(["completion", "bash"])
        .assert()
        .success()
        .stdout(predicate::str::contains("vyltzero"));
}

#[test]
fn completion_generates_zsh() {
    cli()
        .args(["completion", "zsh"])
        .assert()
        .success()
        .stdout(predicate::str::contains("vyltzero"));
}

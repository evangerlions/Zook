plugins {
    kotlin("jvm") version "2.2.20"
}

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(17)
}

tasks.register<JavaExec>("contractFixtureTest") {
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("lighttick.contracts.ContractFixtureCheckKt")
    args(layout.projectDirectory.dir("../../../fixtures/lighttick").asFile.absolutePath)
}

def f():
    arr = []
    for i in range(10):
        arr.append(2 * i)
    return arr


def read(p: str):
    f = open(p, "r")
    return f.read()


def main():
    arr = f()
    print(arr)


if __name__ == "__main__":
    main()
